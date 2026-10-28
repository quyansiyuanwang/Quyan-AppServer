import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/iam-access-key-authority", () => ({ captureIamAccessKeyRevision: vi.fn() }));
vi.mock("@/store/users/iam-oauth-authority", () => ({ captureIamOAuthRevision: vi.fn() }));
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformRelayChannelStatusIamService } from "@/services/relay/platform-relay-channel-status-iam.service";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { batchSetRelayChannelStatusBodySchema } from "@/api/schema/relay/relay-channel.schema";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { candidates: vi.fn(), apply: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn();
const service = new PlatformRelayChannelStatusIamService(iam, repository, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:Allow" },
  }) as unknown as TypedRequest;
const execute = (req: TypedRequest | undefined = request()) =>
  service.execute({ ids: ["first", "second"], enabled: false }, "actor", req, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "matched-allow", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({
    group: { id: "group", updateTime: new Date(0) },
    users: [
      { id: "owner", updateTime: new Date(0) },
      { id: "actor", updateTime: new Date(0) },
    ],
  });
  repository.candidates.mockResolvedValue(
    ["first", "second"].map((id) => ({ id, status: 1, updateTime: new Date(0) })),
  );
  repository.apply.mockImplementation(async (targets, _enabled, guard, persist) => {
    await guard.recheck();
    await guard.recheck();
    return { total: targets.length, affected: persist ? targets.length : 0 };
  });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue({ total: 2, affected: 2 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("resource-level channel status admission", () => {
  it("declares a fixed platform action on the batch route", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "PATCH /v1/relay-channels/batch/status",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:SetChannelStatus"], issues: [] });
    expect(getIamActionDefinition("quyan:relay:SetChannelStatus")).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.RELAY_CHANNEL_UPDATE,
    });
    expect(isIamActionResourceCompatible("quyan:relay:SetChannelStatus", platformRelayChannelArn("first"))).toBe(true);
  });
  it("declares the same server Action on a step-up protected single toggle", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      source = project.addSourceFileAtPath("src/api/controllers/v1/relay/relay-channel.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "PATCH /v1/relay-channels/{id}/toggle",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:SetChannelStatus"], issues: [] });
    const method = source.getClassOrThrow("RelayChannelController").getMethodOrThrow("toggleChannelStatus").getText();
    for (const required of [
      '@Security("jwt")',
      "platformRelayChannelResourceResolver",
      "@TwoFactorChallengeProtected",
      "replayProtectionMiddleware",
      "validateParams(relayChannelIdParamsSchema)",
    ])
      expect(method).toContain(required);
    expect(getIamActionDefinition("quyan:relay:SetChannelStatus")!.apiRoutes).toContain(
      "PATCH /v1/relay-channels/{id}/toggle",
    );
  });
  it.each([{ decisions: [] }, { decisions: [{ decision: "Allow" }] }])(
    "rejects incomplete batch decisions %#",
    async ({ decisions }) => {
      iam.authorizeMany.mockResolvedValue(decisions);
      await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.apply).not.toHaveBeenCalled();
    },
  );
  it("refuses a mode change during authorization rather than writing under a stale mode", async () => {
    snapshots.snapshot.mockImplementation(async () => {
      env.security.iamAuthorizationMode = "legacy";
      return {};
    });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.apply).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("single toggle requires an admitted safe projection, not counts or a second read", async () => {
    repository.candidates.mockResolvedValue([{ id: "first", status: 1, updateTime: new Date(0) }]);
    await expect(service.toggle("first", "actor", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.apply.mock.calls[0]![1]).toBe("toggle");
    expect(repository.apply.mock.calls[0]![4]).toBeTypeOf("function");
    expect(legacy).not.toHaveBeenCalled();
  });
  it("checks every platform resource and does not trust client Action headers", async () => {
    expect(await execute()).toEqual({ total: 2, affected: 2 });
    for (const [input] of iam.authorizeMany.mock.calls)
      expect(input).toMatchObject({
        action: "quyan:relay:SetChannelStatus",
        resources: [platformRelayChannelArn("first"), platformRelayChannelArn("second")],
      });
    expect(repository.apply.mock.calls[0]![1]).toBe(false);
    expect(repository.apply.mock.calls[0]![3]).toBe(true);
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("a %s for any target prevents all writes", async (decision) => {
    iam.authorizeMany.mockResolvedValue([
      { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
      { decision, reason: "no-matching-allow", matchedStatements: [] },
    ]);
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.apply).not.toHaveBeenCalled();
  });
  it("rejects a rebound request after asynchronous access-key proof reads", async () => {
    const req = request();
    vi.mocked(captureIamAccessKeyRevision).mockImplementation(async () => {
      req.authContext!.accountOwnerId = "foreign";
      return undefined;
    });
    await expect(execute(req)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.apply).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("%s calls legacy exactly once without a native write", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await execute();
    expect(legacy).toHaveBeenCalledOnce();
    if (mode === "shadow") expect(repository.apply.mock.calls[0]![3]).toBe(false);
    else expect(repository.apply).not.toHaveBeenCalled();
  });
  it("a failed shadow check never turns into a native write", async () => {
    env.security.iamAuthorizationMode = "shadow";
    snapshots.snapshot.mockRejectedValue(new Error("unavailable"));
    expect(await execute()).toEqual({ total: 2, affected: 2 });
    expect(legacy).toHaveBeenCalledOnce();
    expect(repository.apply).not.toHaveBeenCalled();
  });
  it("fails closed on missing identity or an unknown authorization mode", async () => {
    await expect(execute({} as TypedRequest)).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "unknown" as typeof mode;
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["false", "true", 0, null, undefined])("rejects nonboolean enabled=%j instead of coercing it", (enabled) => {
    expect(batchSetRelayChannelStatusBodySchema.safeParse({ ids: ["first"], enabled }).success).toBe(false);
  });
  it.each([{ ids: [] }, { ids: ["first", "first"] }, { ids: Array.from({ length: 201 }, (_, i) => "id" + i) }])(
    "rejects invalid batch sizes and repeated resources",
    async ({ ids }) => {
      await expect(service.execute({ ids, enabled: false }, "actor", request(), legacy)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(repository.apply).not.toHaveBeenCalled();
    },
  );
});
