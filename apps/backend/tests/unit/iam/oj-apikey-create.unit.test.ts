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
  mutations = { create: vi.fn().mockResolvedValue({ id: "new-key", userId: "actor", key: "fixture-new-only" }) };
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
describe("OJ API Key issuance authorization", () => {
  it("requires a sensitive registered Write Action on the trusted user resource", () => {
    expect(getIamActionDefinition("quyan:oj:CreateApiKey")).toMatchObject({
      accessLevel: "Write",
      resourceTypes: ["quyan/user"],
      sensitive: true,
    });
    expect(getIamActionDefinition("quyan:oj:CreateApiKey")?.defaultAuthorizationScope).toBeUndefined();
    expect(iamActionsForLegacyPermission(Permission.OJ_APIKEY_CREATE)).toContain("quyan:oj:CreateApiKey");
  });
  it("authorizes only the current subject and passes a fresh key to the guarded repository", async () => {
    const result = await service.create("actor", { name: "new" }, "fixture-new-only", request);
    expect(result.key).toBe("fixture-new-only");
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:oj:CreateApiKey", resource: "acs:quyan:*:owner:user/actor" }),
    );
    expect(mutations.create).toHaveBeenCalledWith(
      { userId: "actor", name: "new", key: "fixture-new-only" },
      expect.objectContaining({ identity: expect.objectContaining({ targetUserId: "actor" }) }),
    );
    expect(keys.target).not.toHaveBeenCalled();
  });
  it("does not read channel metadata or create a credential when the parent user is denied", async () => {
    iam.authorize.mockResolvedValue(deny);
    await expect(service.create("actor", { channelId: "channel" }, "fixture", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mutations.create).not.toHaveBeenCalled();
    expect(channels.assertChannelBusinessSelectableMetadataById).not.toHaveBeenCalled();
  });
  it("rechecks the selected channel and the principal grant before committing", async () => {
    const { guard } = await service.prepareCreate("actor", { channelId: "channel" }, request);
    await guard.identity.recheck();
    channels.assertChannelBusinessSelectableMetadataById.mockResolvedValue({ ...channel, updateTime: new Date(1000) });
    await expect(guard.identity.recheck()).rejects.toMatchObject({ statusCode: 403 });
    expect(channels.assertChannelBusinessSelectableMetadataById).toHaveBeenCalledTimes(3);
  });
  it("fails closed for another subject, unknown fields, invalid expiration and account snapshots", async () => {
    await expect(service.prepareCreate("peer", {}, request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepareCreate("actor", { key: "spoofed" } as any, request)).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(service.prepareCreate("actor", { expiresAt: new Date(NaN) }, request)).rejects.toMatchObject({
      statusCode: 400,
    });
    users.targets.mockResolvedValue([]);
    await expect(service.prepareCreate("actor", {}, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("declares a fixed parent resource and retains 2FA, replay and body validation", () => {
    const file = "src/api/controllers/v1/oj-submitter/oj-apikey.controller.ts",
      project = new Project({ useInMemoryFileSystem: true }),
      source = project.createSourceFile("/backend/" + file, readFileSync(file, "utf8"));
    expect(collectIamRoutes([source], "/backend").find((r) => r.method === "createAPIKey")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:oj:CreateApiKey"],
      resourceKind: "single-resource",
      issues: [],
    });
    const method = source.getClassOrThrow("OJAPIKeyController").getMethodOrThrow("createAPIKey");
    expect(method.getDecorator("TwoFactorChallengeProtected")).toBeDefined();
    expect(method.getDecorator("Middlewares")?.getText()).toContain("replayProtectionMiddleware");
    expect(method.getDecorator("Middlewares")?.getText()).toContain("validateBody(createOJAPIKeyBodySchema)");
  });
});
