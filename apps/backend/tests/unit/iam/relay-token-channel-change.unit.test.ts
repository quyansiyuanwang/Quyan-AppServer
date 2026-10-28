import { describe, it, expect, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import {
  planRelayTokenChannelChange,
  type RelayTokenChannelSource,
} from "@/store/relay/relay-token-channel-change.repository";
import { RELAY_TOKEN_ROUTING_LIMITS } from "@/constant/relay-token";
import {
  normalizeRelayChannelVisibilityConfig,
  isRelayChannelVisible,
} from "@/util/relay/relay-channel-visibility.util";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const source = (): RelayTokenChannelSource => ({
  id: "token",
  userId: "actor",
  status: 1,
  updateTime: new Date(0),
  routingMode: "ordered",
  channelId: "first",
  automaticProxyPoolChannelId: null,
  memberTokenConfigs: [],
  channelConfigs: ["first", "second"].map((channelId, priority) => ({
    id: "config" + priority,
    channelId,
    priority,
    updateTime: new Date(0),
  })),
});
describe("server-defined token channel selection", () => {
  it("declares native route metadata, secondary selection and separate management authority", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "PUT /v1/relay/tokens/{id}/channel",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:UpdateTokenChannel"], issues: [] });
    expect(getIamActionDefinition("quyan:relay:UpdateTokenChannel")!.conditionalActions).toContain(
      "quyan:relay:SelectTokenChannel",
    );
    expect(getIamActionDefinition("quyan:relay:UpdateManagedTokenChannel")!.authorizationBoundary).toBe("platform");
    expect(getIamActionDefinition("quyan:relay:SelectTokenChannel")!.legacyPermission).toBe(
      Permission.RELAY_TOKEN_UPDATE,
    );
    expect(
      isIamActionResourceCompatible("quyan:relay:SelectTokenChannel", relayChannelSelectionArn("owner", "channel")),
    ).toBe(true);
    expect(
      isIamActionResourceCompatible("quyan:relay:UpdateTokenChannel", relayChannelSelectionArn("owner", "channel")),
    ).toBe(false);
  });
  it("maps legacy UPDATE to account channel selection without granting platform channel management", () => {
    const policy = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_UPDATE], "owner", "actor")!;
    expect(
      evaluatePolicies([{ policyId: "fixture", document: policy }], {
        action: "quyan:relay:SelectTokenChannel",
        resource: relayChannelSelectionArn("owner", "channel"),
      }).decision,
    ).toBe("Allow");
    expect(
      evaluatePolicies([{ policyId: "fixture", document: policy }], {
        action: "quyan:relay:SelectTokenChannel",
        resource: relayChannelSelectionArn("foreign", "channel"),
      }).decision,
    ).toBe("ImplicitDeny");
  });
  it("keeps compatibility update authority limited to the actor's own tokens", () => {
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_UPDATE], "owner", "actor")!;
    for (const [user, decision] of [
      ["actor", "Allow"],
      ["peer", "ImplicitDeny"],
    ])
      expect(
        evaluatePolicies([{ policyId: "fixture", document }], {
          action: "quyan:relay:UpdateTokenChannel",
          resource: `acs:relay:*:owner:token/${user}/token`,
        }).decision,
      ).toBe(decision);
  });
  it("reorders without dropping any existing channel and leaves the source untouched", () => {
    const before = source();
    expect(planRelayTokenChannelChange(before, "second").configs).toEqual([
      { channelId: "second", priority: 0 },
      { channelId: "first", priority: 1 },
    ]);
    expect(before.channelConfigs[0]!.channelId).toBe("first");
    expect(planRelayTokenChannelChange(before, "third").configs.map((row) => row.channelId)).toEqual([
      "third",
      "first",
      "second",
    ]);
  });
  it("recovers legacy primary-only tokens as an ordered list", () => {
    const before = source();
    before.channelConfigs = [];
    expect(planRelayTokenChannelChange(before, "second").configs.map((row) => row.channelId)).toEqual([
      "second",
      "first",
    ]);
  });
  it("allows an unbound ordered token to select its first channel", () => {
    const before = source();
    before.channelConfigs = [];
    before.channelId = null;
    expect(planRelayTokenChannelChange(before, "second").configs).toEqual([{ channelId: "second", priority: 0 }]);
  });
  it.each(["automatic-pool", "composite", "unknown"])("does not reinterpret %s as ordered", (routingMode) => {
    expect(() => planRelayTokenChannelChange({ ...source(), routingMode }, "second")).toThrow();
  });
  it.each(["automatic", "members", "duplicate-id", "duplicate-priority", "missing-primary"])(
    "fails closed on malformed source %s",
    (kind) => {
      const row = source();
      if (kind === "automatic") row.automaticProxyPoolChannelId = "automatic";
      else if (kind === "members") row.memberTokenConfigs = [{ id: "member" }];
      else if (kind === "duplicate-id") row.channelConfigs[1]!.channelId = "first";
      else if (kind === "duplicate-priority") row.channelConfigs[1]!.priority = 0;
      else row.channelId = "not-a-member";
      expect(() => planRelayTokenChannelChange(row, "third")).toThrow();
    },
  );
  it("enforces the same ordered capacity as request validation", () => {
    const row = source();
    row.channelId = "channel0";
    row.channelConfigs = Array.from({ length: RELAY_TOKEN_ROUTING_LIMITS.channels }, (_, priority) => ({
      id: "config" + priority,
      channelId: "channel" + priority,
      priority,
      updateTime: new Date(0),
    }));
    expect(planRelayTokenChannelChange(row, "channel1").configs).toHaveLength(RELAY_TOKEN_ROUTING_LIMITS.channels);
    expect(() => planRelayTokenChannelChange(row, "overflow")).toThrow();
  });
  it.each(["*", "bad/id", "", "bad\nvalue"])("rejects untrusted resource identifier %j", (id) => {
    expect(() => relayChannelSelectionArn("owner", id)).toThrow();
    expect(() => planRelayTokenChannelChange(source(), id)).toThrow();
  });
});
describe("credential-free business visibility", () => {
  const actor = { id: "actor", groupId: "group", roleIds: ["role"] };
  it.each(["userIds", "groupIds", "roleIds"])("accepts matching %s without granting IAM permissions", (key) => {
    const value = { userIds: "actor", groupIds: "group", roleIds: "role" }[key]!;
    expect(isRelayChannelVisible({ visibilityMode: "whitelist", visibilityConfig: { [key]: [value] } }, actor)).toBe(
      true,
    );
  });
  it.each(["private", "hidden", "unknown"])("does not bypass %s", (visibilityMode) => {
    expect(isRelayChannelVisible({ visibilityMode, visibilityConfig: { userIds: ["actor"] } }, actor)).toBe(false);
  });
  it("keeps only string identifiers and treats malformed lists as empty", () => {
    expect(
      normalizeRelayChannelVisibilityConfig({ userIds: ["actor", false, null, {}, ""], groupIds: "group" }),
    ).toEqual({ userIds: ["actor"], groupIds: [], roleIds: [] });
    expect(isRelayChannelVisible({ visibilityMode: "whitelist", visibilityConfig: null }, actor)).toBe(false);
    expect(isRelayChannelVisible({ visibilityMode: "public", visibilityConfig: null }, actor)).toBe(true);
  });
});
