import { MAX_RETRY_STATUS_RULES, matchesRetryStatusRule } from "@/util/relay/relay-failover-status-rule.util";
import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { getIamActionDefinition, isIamActionResourceCompatible, Permission } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import {
  projectRelayChannelExport,
  type RelayChannelExportSource,
} from "@/services/relay/relay-channel-export-projection";
const action = "quyan:relay:ExportChannels",
  resource = "acs:platform:*:platform:relay-channel/channel";
const fixture = (): RelayChannelExportSource => ({
  id: "fixture",
  name: "Fixture",
  status: 1,
  channelType: "standalone",
  routingStrategy: "priority",
  routingConfig: null,
  visibilityMode: "public",
  visibilityConfig: null,
  pooledParentId: null,
  pooledPriority: 0,
  pooledWeight: 1 as never,
  pooledMemberEnabled: true,
  useProxy: false,
  multiplier: 1 as never,
  allowedFormats: "openai-chat-completions",
  allowedModels: null,
  addUserIdentifier: true,
  inputTokensIncludeCacheRead: false,
  modelMapping: null,
  timePeriodMultipliers: null,
  contextLengthMultipliers: null,
  createTime: new Date("2026-01-01"),
  updateTime: new Date("2026-01-01"),
});
describe("credential-free channel export contract", () => {
  it("pins the route to a platform export capability and preserves explicit legacy removals", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "POST /v1/relay-channels/export",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "collection", issues: [] });
    expect(getIamActionDefinition(action)).toMatchObject({
      resourceTypes: ["platform/relay-channel"],
      authorizationBoundary: "platform",
    });
    expect(isIamActionResourceCompatible(action, resource)).toBe(true);
    expect(isIamActionResourceCompatible(action, "acs:relay:*:owner:channel-selection/channel")).toBe(false);
    const allow = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_EXPORT], "owner", "actor")!,
      deny = legacyPermissionsToPrincipalPolicy([Permission.RELAY_CHANNEL_EXPORT], "owner", "actor", "Deny")!;
    expect(evaluatePolicies([{ policyId: "a", document: allow }], { action, resource }).decision).toBe("Allow");
    expect(
      evaluatePolicies(
        [
          { policyId: "a", document: allow },
          { policyId: "d", document: deny },
        ],
        { action, resource },
      ).decision,
    ).toBe("ExplicitDeny");
  });
  it("strips credential-bearing top-level and unknown nested fields while preserving supported configuration", () => {
    const source = {
      ...fixture(),
      openaiUpstreamApiKey: "fixture-key",
      openaiUpstreamUrl: "https://fixture.invalid/private",
      providers: [{ password: "fixture-key" }],
      routingConfig: { maxRetries: 2, secret: "fixture-key", retryStatusCodes: ["/^50[23]$|fixture-key/"] },
      contextLengthMultipliers: [
        { name: "context", enabled: true, minTokens: 1000, multiplier: 2, secret: "fixture-key" },
      ],
      visibilityConfig: { userIds: ["user"], secret: "fixture-key" },
    };
    const result = projectRelayChannelExport(source, [
      { memberChannelId: "member", priority: 0, weight: 1, enabled: true, apiKey: "fixture-key" } as never,
    ]);
    expect(result.routingConfig).toEqual({ maxRetries: 2, retryStatusCodes: [502, 503] });
    expect(result.contextLengthMultipliers).toEqual([
      { name: "context", enabled: true, minTokens: 1000, multiplier: 2 },
    ]);
    expect(result.visibilityConfig).toEqual({ userIds: ["user"] });
    expect(result.poolMembers).toEqual([{ memberChannelId: "member", priority: 0, weight: 1, enabled: true }]);
    expect(JSON.stringify(result)).not.toMatch(/fixture-key|fixture.invalid|Upstream|providers|secret/);
    expect(JSON.stringify(source)).toContain("fixture-key");
  });
  it("keeps broad retry expansion portable and idempotent within the canonical rule limit", () => {
    const source = { ...fixture(), routingConfig: { retryStatusCodes: ["/^5|fixture-private-text/"] } };
    const result = projectRelayChannelExport(source, []);
    const rules = result.routingConfig!.retryStatusCodes!;
    expect(rules.length).toBeLessThanOrEqual(MAX_RETRY_STATUS_RULES);
    expect(JSON.stringify(rules)).not.toContain("fixture-private-text");
    for (let code = 100; code <= 599; code++)
      expect(rules.some((rule) => matchesRetryStatusRule(code, rule))).toBe(code >= 500);
    expect(
      projectRelayChannelExport({ ...fixture(), routingConfig: result.routingConfig as never }, []).routingConfig,
    ).toEqual(result.routingConfig);
  });
  it("fails closed rather than echoing malformed or arbitrary persisted retry text", () => {
    expect(() =>
      projectRelayChannelExport({ ...fixture(), routingConfig: { retryStatusCodes: ["fixture-private"] } }, []),
    ).toThrow();
  });
});
