import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/system/content-safety.service", () => ({ ContentSafetyService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/iam-access-key-authority", () => ({ captureIamAccessKeyRevision: vi.fn() }));
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { env } from "@/config/env";
import { RelayTokenBatchUpdateIamService } from "@/services/relay/relay-token-batch-update-iam.service";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { RELAY_TOKEN_AUTHORITY_REQUIREMENTS } from "@/store/relay/relay-token-authority";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { batchSetRelayTokenStatusBodySchema } from "@/api/schema/relay/relay.schema";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { snapshot: vi.fn(), candidates: vi.fn(), apply: vi.fn(), tokenOwner: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  safety = { getEffectivePolicy: vi.fn() },
  legacy = vi.fn();
const service = new RelayTokenBatchUpdateIamService(iam, repository, permissions, safety);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:relay:DeleteToken" },
    secure: true,
  }) as unknown as TypedRequest;
const status = (input = { ids: ["token"], enabled: false }, req: TypedRequest | undefined = request()) =>
  service.setStatus("actor", input, req, legacy);
const content = (mode: "snapshot" | "clear" = "snapshot", targetUserId?: string, req = request()) =>
  service.setContentSafety("actor", { ids: ["token"], mode, targetUserId }, req, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  repository.snapshot.mockResolvedValue({ users: [] });
  repository.candidates.mockResolvedValue([{ id: "token", userId: "actor", status: 1, updateTime: new Date(0) }]);
  repository.apply.mockImplementation(async (_targets, guard, _change, persist) => {
    await guard.recheck();
    await guard.authorize();
    return { total: 1, affected: persist ? 1 : 0 };
  });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  safety.getEffectivePolicy.mockResolvedValue({ requestEnabled: true, requestAction: "block" });
  legacy.mockResolvedValue({ total: 1, affected: 1 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("resource-scoped batch token metadata updates", () => {
  it("declares real actions and collection authorization at both routes", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [name, action] of [
      ["batchSetTokenStatus", "SetTokenStatus"],
      ["batchContentSafety", "SetTokenContentSafety"],
    ]) {
      const route = routes.find((route) => route.method === name);
      expect(route).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:" + action], issues: [] });
      expect(getIamActionDefinition("quyan:relay:" + action)).toMatchObject({
        accessLevel: "Write",
        authorizationStage: "declared",
      });
      expect(isIamActionResourceCompatible("quyan:relay:" + action, relayTokenArn("owner", "actor", "token"))).toBe(
        true,
      );
      expect(isIamActionResourceCompatible("quyan:relay:" + action, platformRelayTokenArn("peer", "token"))).toBe(
        false,
      );
    }
  });
  it("uses the UPDATE OAuth and management profile, never read/delete ceilings", () => {
    expect(RELAY_TOKEN_AUTHORITY_REQUIREMENTS.update).toEqual({
      operationPermission: Permission.RELAY_TOKEN_UPDATE,
      managementPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE,
    });
  });
  it.each(["SetTokenStatus", "SetTokenContentSafety"])(
    "projects legacy UPDATE only into own token scope for %s",
    (operation) => {
      const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_UPDATE], "owner", "actor")!;
      const decide = (resource: string) =>
        evaluatePolicies([{ policyId: "fixture", document }], { action: "quyan:relay:" + operation, resource })
          .decision;
      expect(decide(relayTokenArn("owner", "actor", "token"))).toBe("Allow");
      expect(decide(relayTokenArn("owner", "peer", "token"))).toBe("ImplicitDeny");
      expect(decide(relayTokenArn("foreign", "actor", "token"))).toBe("ImplicitDeny");
    },
  );
  it("ignores client action headers, chooses fixed status data and never calls read/reveal", async () => {
    expect(await status()).toEqual({ total: 1, affected: 1, userId: "actor" });
    expect(repository.apply.mock.calls[0]![2]).toEqual({ kind: "status", enabled: false });
    expect(repository.snapshot).toHaveBeenCalledWith(expect.anything(), "status");
    expect(new Set(iam.authorizeMany.mock.calls.map(([input]) => input.action))).toEqual(
      new Set(["quyan:relay:SetTokenStatus"]),
    );
    expect(safety.getEffectivePolicy).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("snapshots the target user's effective safety policy after admission", async () => {
    await content("snapshot", "peer");
    expect(safety.getEffectivePolicy).toHaveBeenCalledExactlyOnceWith("peer", null);
    expect(repository.apply.mock.calls[0]![2]).toEqual({
      kind: "content-safety",
      config: { requestEnabled: true, requestAction: "block" },
    });
    const calls = iam.authorizeMany.mock.calls.map(([input]) => ({ action: input.action, resources: input.resources }));
    expect(calls).toContainEqual({
      action: "quyan:relay:SetTokenContentSafety",
      resources: ["acs:quyan:*:owner:user/actor"],
    });
    expect(calls).toContainEqual({
      action: "quyan:relay:SetManagedTokenContentSafety",
      resources: [platformUserArn("peer")],
    });
    expect(calls).toContainEqual({
      action: "quyan:relay:SetManagedTokenContentSafety",
      resources: [platformRelayTokenArn("peer", "token")],
    });
  });
  it("clears the stored override without reading or substituting an effective policy", async () => {
    await content("clear");
    expect(repository.apply.mock.calls[0]![2]).toEqual({ kind: "content-safety", config: null });
    expect(safety.getEffectivePolicy).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      [{ decision: "ExplicitDeny" }],
      [{ decision: "Allow" }, { decision: "Allow" }],
      [{ decision: "unexpected" }],
    ].map((outcomes) => ({ outcomes })),
  )("denies incomplete, denied or malformed outcome arrays %j", async ({ outcomes }) => {
    iam.authorizeMany.mockResolvedValue(outcomes);
    await expect(status()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.apply).not.toHaveBeenCalled();
  });
  it("does not read safety configuration when resource admission fails", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny" }]);
    await expect(content()).rejects.toMatchObject({ statusCode: 403 });
    expect(safety.getEffectivePolicy).not.toHaveBeenCalled();
  });
  it("rechecks request identity before mutation completion", async () => {
    const req = request();
    repository.apply.mockImplementation(async (_targets, guard) => {
      req.authContext!.accountOwnerId = "foreign";
      await guard.recheck();
    });
    await expect(status(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not accept request rebinding during asynchronous authority reads", async () => {
    const req = request();
    repository.apply.mockImplementation(async (_targets, guard) => {
      repository.snapshot.mockImplementation(async () => {
        req.authContext!.accountOwnerId = "foreign";
        return { users: [] };
      });
      await guard.recheck();
    });
    await expect(status(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks policy changes even when they still return Allow", async () => {
    repository.apply.mockImplementation(async (_targets, guard) => {
      iam.loadPolicies.mockResolvedValue([
        {
          policyId: "new",
          document: {
            Version: "1",
            Statement: [{ Effect: "Allow", Action: ["quyan:relay:SetTokenStatus"], Resource: ["*"] }],
          },
        },
      ]);
      await guard.recheck();
    });
    await expect(status()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks AccessKey authority without substituting JWT", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: "key" } as TypedRequest["accessKey"];
    vi.mocked(captureIamAccessKeyRevision).mockResolvedValue("initial");
    repository.apply.mockImplementation(async (_targets, guard) => {
      vi.mocked(captureIamAccessKeyRevision).mockResolvedValue("revoked");
      await guard.recheck();
    });
    await expect(status(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks current policy fingerprints and per-resource decisions", async () => {
    repository.apply.mockImplementation(async (_targets, guard) => {
      iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny" }]);
      await guard.authorize();
    });
    await expect(status()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects non-boolean JSON instead of treating the string false as true", async () => {
    for (const enabled of ["false", "true", 0, 1, null]) {
      expect(batchSetRelayTokenStatusBodySchema.safeParse({ ids: ["token"], enabled }).success).toBe(false);
      await expect(status({ ids: ["token"], enabled } as never)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(iam.loadPolicies).not.toHaveBeenCalled();
  });
  it.each([
    { ids: [], enabled: false },
    { ids: ["token", "token"], enabled: false },
    { ids: ["../token"], enabled: false },
    { ids: ["token"], enabled: false, action: "*" },
  ])("rejects malformed selections %j", async (input) => {
    await expect(status(input)).rejects.toMatchObject({ statusCode: 400 });
    expect(iam.loadPolicies).not.toHaveBeenCalled();
  });
  it("shadow only previews native mutation and executes legacy once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    expect(await content()).toEqual({ total: 1, affected: 1 });
    expect(repository.apply.mock.calls[0]![3]).toBe(false);
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("legacy never reads policies/configuration and retains its operation ceiling", async () => {
    env.security.iamAuthorizationMode = "legacy";
    await content();
    expect(iam.loadPolicies).not.toHaveBeenCalled();
    expect(safety.getEffectivePolicy).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(status()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("enforce fails closed on native database failures", async () => {
    repository.apply.mockRejectedValue(new Error("fixture unavailable"));
    await expect(status()).rejects.toThrow("fixture unavailable");
    expect(legacy).not.toHaveBeenCalled();
  });
});
