import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/iam-access-key-authority", () => ({ captureIamAccessKeyRevision: vi.fn() }));
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { env } from "@/config/env";
import { RelayTokenDeleteIamService } from "@/services/relay/relay-token-delete-iam.service";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { RELAY_TOKEN_AUTHORITY_REQUIREMENTS } from "@/store/relay/relay-token-authority";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { snapshot: vi.fn(), tokenOwner: vi.fn(), candidates: vi.fn(), remove: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn();
const service = new RelayTokenDeleteIamService(iam, repository, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:relay:RevealToken" },
    secure: true,
  }) as unknown as TypedRequest;
const remove = (req: TypedRequest | undefined = request(), input = { ids: ["token"] }, single = false) =>
  service.remove("actor", input, req, single, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  repository.snapshot.mockResolvedValue({ users: [] });
  repository.tokenOwner.mockResolvedValue("actor");
  repository.candidates.mockResolvedValue([{ id: "token", userId: "actor", status: 1, updateTime: new Date(0) }]);
  repository.remove.mockImplementation(async (_targets, guard, persist) => {
    await guard.recheck();
    await guard.authorize();
    return { total: 1, affected: persist ? 1 : 0 };
  });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue({ total: 1, affected: 1 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("resource-scoped token deletion protocol", () => {
  it("declares fixed server actions for single and batch deletion", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const key of ["DELETE /v1/relay/tokens/{id}", "POST /v1/relay/tokens/batch/delete"])
      expect(routes.find((row) => row.key === key)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:relay:DeleteToken"],
        issues: [],
      });
    expect(getIamActionDefinition("quyan:relay:DeleteToken")).toMatchObject({
      accessLevel: "Write",
      legacyPermission: Permission.RELAY_TOKEN_DELETE,
      conditionalActions: ["quyan:relay:DeleteManagedToken"],
    });
    expect(getIamActionDefinition("quyan:relay:DeleteManagedToken")).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE,
    });
  });
  it("does not broaden personal deletes to platform or unrelated resources", () => {
    expect(isIamActionResourceCompatible("quyan:relay:DeleteToken", relayTokenArn("owner", "actor", "token"))).toBe(
      true,
    );
    expect(isIamActionResourceCompatible("quyan:relay:DeleteToken", platformRelayTokenArn("peer", "token"))).toBe(
      false,
    );
    expect(isIamActionResourceCompatible("quyan:relay:DeleteManagedToken", platformUserArn("peer"))).toBe(true);
    expect(isIamActionResourceCompatible("quyan:relay:DeleteToken", "acs:quyan:*:owner:policy/policy")).toBe(false);
  });
  it("projects legacy DELETE only to authenticated own tokens", () => {
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_DELETE], "owner", "actor")!;
    const decision = (resource: string) =>
      evaluatePolicies([{ policyId: "fixture", document }], { action: "quyan:relay:DeleteToken", resource }).decision;
    expect(decision(relayTokenArn("owner", "actor", "token"))).toBe("Allow");
    expect(decision(relayTokenArn("owner", "peer", "token"))).toBe("ImplicitDeny");
    expect(decision(relayTokenArn("foreign", "actor", "token"))).toBe("ImplicitDeny");
  });
  it("uses operation-specific OAuth and management ceilings instead of reusing READ", () => {
    expect(RELAY_TOKEN_AUTHORITY_REQUIREMENTS.delete).toEqual({
      operationPermission: Permission.RELAY_TOKEN_DELETE,
      managementPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_UPDATE,
    });
    expect(RELAY_TOKEN_AUTHORITY_REQUIREMENTS.read).toEqual({
      operationPermission: Permission.RELAY_TOKEN_READ,
      managementPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_READ,
    });
  });
  it("ignores client action input and passes only preauthorized metadata into the mutation", async () => {
    expect(await remove()).toEqual({ total: 1, affected: 1, userId: "actor" });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:relay:DeleteToken",
        resources: [relayTokenArn("owner", "actor", "token")],
      }),
    );
    expect(repository.remove.mock.calls[0]![2]).toBe(true);
    expect(legacy).not.toHaveBeenCalled();
  });
  it("requires every resource decision, including a complete response batch", async () => {
    iam.authorizeMany.mockResolvedValue([]);
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.candidates).not.toHaveBeenCalled();
    iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny" }]);
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not use a token's discovered owner to grant platform eligibility", async () => {
    repository.tokenOwner.mockResolvedValue("peer");
    repository.snapshot.mockRejectedValue(new Error("fixture missing global group qualification"));
    await expect(remove(request(), { ids: ["token"] }, true)).rejects.toThrow();
    expect(repository.remove).not.toHaveBeenCalled();
  });
  it("checks personal and platform target admission separately", async () => {
    await service.remove("actor", { ids: ["token"], targetUserId: "peer" }, request(), false, legacy);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:DeleteToken", resources: ["acs:quyan:*:owner:user/actor"] }),
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:relay:DeleteManagedToken", resources: [platformUserArn("peer")] }),
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:relay:DeleteManagedToken",
        resources: [platformRelayTokenArn("peer", "token")],
      }),
    );
  });
  it("rechecks policy revisions at the actual mutation boundary", async () => {
    repository.remove.mockImplementation(async (_targets, guard) => {
      iam.loadPolicies.mockResolvedValue([
        {
          policyId: "changed",
          document: {
            Version: "1",
            Statement: [{ Effect: "Deny", Action: ["quyan:relay:DeleteToken"], Resource: ["*"] }],
          },
        },
      ]);
      await guard.recheck();
    });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rechecks current decisions rather than treating a fixed policy hash as a permanent grant", async () => {
    repository.remove.mockImplementation(async (_targets, guard) => {
      iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] }]);
      await guard.authorize();
    });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks AccessKey revisions and never replaces a revoked credential with JWT authority", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: "key" } as TypedRequest["accessKey"];
    vi.mocked(captureIamAccessKeyRevision).mockResolvedValue("initial");
    repository.remove.mockImplementation(async (_targets, guard) => {
      vi.mocked(captureIamAccessKeyRevision).mockResolvedValue("changed");
      await guard.recheck();
    });
    await expect(remove(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects mutation of the trusted request identity", async () => {
    const req = request();
    repository.remove.mockImplementation(async (_targets, guard) => {
      req.authContext!.accountOwnerId = "foreign";
      await guard.recheck();
    });
    await expect(remove(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    {},
    { user: { userId: "actor" } },
    { user: { userId: "actor" }, authContext: { principalUserId: "other", accountOwnerId: "owner" } },
  ])("fails closed on missing or substituted principals %j", async (req) => {
    await expect(remove(req as TypedRequest)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.remove).not.toHaveBeenCalled();
  });
  it.each([{ ids: [] }, { ids: ["token", "token"] }, { ids: ["../token"] }, { ids: ["token"], permission: "*" }])(
    "rejects invalid deletion selection %j before policies are loaded",
    async (input) => {
      await expect(remove(request(), input)).rejects.toMatchObject({ statusCode: 400 });
      expect(iam.loadPolicies).not.toHaveBeenCalled();
    },
  );
  it("does not allow a single-delete invocation to hide a second target", async () => {
    await expect(remove(request(), { ids: ["one", "two"] }, true)).rejects.toMatchObject({ statusCode: 400 });
  });
  it("shadow previews without persisting then calls legacy once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    expect(await remove()).toEqual({ total: 1, affected: 1 });
    expect(repository.remove.mock.calls[0]![2]).toBe(false);
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("legacy avoids native policy reads and enforces its permission ceiling", async () => {
    env.security.iamAuthorizationMode = "legacy";
    await remove();
    expect(repository.remove).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("does not fail open in enforce mode when the mutation repository is unavailable", async () => {
    repository.remove.mockRejectedValue(new Error("fixture unavailable"));
    await expect(remove()).rejects.toThrow("fixture unavailable");
    expect(legacy).not.toHaveBeenCalled();
  });
});
