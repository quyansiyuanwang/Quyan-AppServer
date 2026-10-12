import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/oj-submitter/oj-apikey-mutation.repository", () => ({
  OjApiKeyMutationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", () => ({ IamAccountUserRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/relay/relay-channel.service", () => ({ RelayChannelService: { getInstance: vi.fn() } }));
vi.mock("@/store/oj-submitter/oj-apikey-management.repository", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    OjApiKeyManagementRepository: { getInstance: vi.fn() },
    ojApiKeyDenied: () =>
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { readFileSync } from "node:fs";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { OjApiKeyMutationIamService } from "@/services/oj-submitter/oj-apikey-mutation-iam.service";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
let service: OjApiKeyMutationIamService,
  iam: any,
  keys: any,
  users: any,
  channels: any,
  mutations: any,
  request: TypedRequest;
const channel = {
  id: "channel",
  name: "fixture",
  updateTime: new Date(0),
  status: 1,
  visibilityMode: "public",
  channelType: "standalone",
};
beforeEach(() => {
  iam = { loadPolicies: vi.fn().mockResolvedValue([]), authorize: vi.fn().mockResolvedValue(allow) };
  keys = {
    target: vi
      .fn()
      .mockResolvedValue({ id: "key", userId: "actor", status: 1, updateTime: new Date(0), createTime: new Date(0) }),
  };
  users = {
    targets: vi
      .fn()
      .mockImplementation(async (_: unknown, ids: string[]) => ids.map((id) => ({ id, updateTime: new Date(0) }))),
  };
  channels = { assertChannelBusinessSelectableMetadataById: vi.fn().mockResolvedValue(channel) };
  mutations = { update: vi.fn().mockResolvedValue({ id: "key", userId: "actor", name: "new" }) };
  service = new (OjApiKeyMutationIamService as unknown as new (...args: any[]) => OjApiKeyMutationIamService)(
    iam,
    keys,
    users,
    channels,
    mutations,
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    body: { accountId: "foreign" },
  } as unknown as TypedRequest;
});
describe("OJ API Key update authorization", () => {
  it("registers fixed key-scoped updates with independent sensitive disclosure", () => {
    expect(getIamActionDefinition("quyan:oj:UpdateApiKey")).toMatchObject({
      accessLevel: "Write",
      resourceTypes: ["oj/api-key"],
      conditionalActions: ["quyan:oj:RevealApiKey"],
    });
    expect(iamActionsForLegacyPermission(Permission.OJ_APIKEY_UPDATE)).toContain("quyan:oj:UpdateApiKey");
  });
  it("authorizes the real subject key before loading channel metadata and before writes", async () => {
    await service.update("key", "actor", { channelId: "channel", name: "new" }, request);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:oj:UpdateApiKey", resource: "acs:oj:*:owner:api-key/actor/key" }),
    );
    expect(channels.assertChannelBusinessSelectableMetadataById).toHaveBeenCalledWith("channel", "actor");
    expect(mutations.update).toHaveBeenCalledWith(
      { channelId: "channel", name: "new" },
      expect.objectContaining({ target: expect.objectContaining({ id: "key", userId: "actor" }) }),
    );
  });
  it("does not read channel data or mutate after Deny", async () => {
    iam.authorize.mockResolvedValue(deny);
    await expect(service.update("key", "actor", { channelId: "channel" }, request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(channels.assertChannelBusinessSelectableMetadataById).not.toHaveBeenCalled();
    expect(mutations.update).not.toHaveBeenCalled();
  });
  it("can change metadata while separately denying the existing key value", async () => {
    iam.authorize.mockImplementation(async ({ action }: { action: string }) =>
      action === "quyan:oj:RevealApiKey" ? deny : allow,
    );
    const { guard } = await service.prepareUpdate("key", "actor", { name: "new" }, request);
    await guard.identity.recheck();
    expect(await guard.canReveal()).toBe(false);
  });
  it("checks channel version and selection permissions again inside the commit guard", async () => {
    const { guard } = await service.prepareUpdate("key", "actor", { channelId: "channel" }, request);
    channels.assertChannelBusinessSelectableMetadataById.mockResolvedValue({ ...channel, updateTime: new Date(1000) });
    await expect(guard.identity.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects missing, misbound and disabled key targets", async () => {
    for (const target of [
      null,
      { id: "key", userId: "foreign", status: 1, updateTime: new Date(0) },
      { id: "key", userId: "actor", status: 0, updateTime: new Date(0) },
    ]) {
      keys.target.mockResolvedValue(target);
      await expect(service.prepareUpdate("key", "actor", {}, request)).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("refuses a missing account snapshot and unknown update fields", async () => {
    users.targets.mockResolvedValue([]);
    await expect(service.prepareUpdate("key", "actor", {}, request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepareUpdate("key", "actor", { key: "spoofed" } as any, request)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
  it.each([{ channelId: "" }, { channelId: "*" }, { expiresAt: new Date(NaN) }, { name: "x".repeat(101) }])(
    "rejects invalid input %j",
    async (input) => {
      await expect(service.prepareUpdate("key", "actor", input, request)).rejects.toMatchObject({ statusCode: 400 });
      expect(mutations.update).not.toHaveBeenCalled();
    },
  );
  it("declares exact key resource metadata and retains params/body validation", () => {
    const file = "src/api/controllers/v1/oj-submitter/oj-apikey.controller.ts",
      project = new Project({ useInMemoryFileSystem: true }),
      source = project.createSourceFile("/backend/" + file, readFileSync(file, "utf8"));
    expect(collectIamRoutes([source], "/backend").find((r) => r.method === "updateAPIKey")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:oj:UpdateApiKey"],
      resourceKind: "single-resource",
      issues: [],
    });
    const middleware = source
      .getClassOrThrow("OJAPIKeyController")
      .getMethodOrThrow("updateAPIKey")
      .getDecorator("Middlewares")
      ?.getText();
    expect(middleware).toContain("validateParams");
    expect(middleware).toContain("validateBody");
  });
});
