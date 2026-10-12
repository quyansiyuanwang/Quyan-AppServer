import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/services/users/auth-center-client-iam.service", () => ({
  AuthCenterClientIamService: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/auth-center-client-management.repository", () => ({
  AuthCenterClientManagementRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/auth-center-client-mutation.repository", () => ({
  AuthCenterClientMutationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    IamAccountUserRepository: { getInstance: vi.fn() },
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { AuthCenterClientMutationIamService } from "@/services/users/auth-center-client-mutation-iam.service";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { Project } from "ts-morph";
import type { TypedRequest } from "@/types/express";
const target = {
    id: "client",
    userId: "actor",
    status: 1,
    createTime: new Date(0),
    updateTime: new Date(0),
  },
  principal = { subjectUserId: "actor", principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" };
let iam: any,
  reads: any,
  repo: any,
  users: any,
  mutations: any,
  service: AuthCenterClientMutationIamService,
  request: TypedRequest;
beforeEach(() => {
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
  } as unknown as TypedRequest;
  iam = { authorize: vi.fn().mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] }) };
  reads = { identity: vi.fn().mockResolvedValue({ identity: { principal }, request }) };
  repo = {
    target: vi.fn().mockResolvedValue(target),
    hydrate: vi.fn().mockResolvedValue([{ ...target, name: "fixture", reviewStatus: "draft", hasClientSecret: true }]),
  };
  users = {
    targets: vi
      .fn()
      .mockImplementation(async (_: any, ids: string[]) => ids.map((id) => ({ id, updateTime: new Date(0) }))),
  };
  mutations = { update: vi.fn().mockResolvedValue({ ...target, name: "updated" }) };
  service = new (AuthCenterClientMutationIamService as unknown as new (
    ...args: any[]
  ) => AuthCenterClientMutationIamService)(iam, reads, repo, users, mutations);
});
describe("auth center client creation authorization", () => {
  it("declares creation on the authenticated user parent and retains sensitive request guards", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const source = project.addSourceFileAtPath("src/api/controllers/v1/users/auth-center-client.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.key === "POST /v1/auth-center/clients")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:auth_center:CreateClient"],
      resourceKind: "single-resource",
      issues: [],
    });
    expect(getIamActionDefinition("quyan:auth_center:CreateClient")).toMatchObject({
      sensitive: true,
      resourceTypes: ["quyan/user"],
    });
    expect(iamActionsForLegacyPermission(Permission.AUTH_CENTER_CLIENT_CREATE)).toContain(
      "quyan:auth_center:CreateClient",
    );
    const method = source.getClassOrThrow("AuthCenterClientController").getMethodOrThrow("createClient");
    expect(method.getDecorator("TwoFactorChallengeProtected")).toBeDefined();
    expect(method.getText()).toContain("twoFactorChallengeMiddleware");
    expect(method.getText()).toContain("replayProtectionMiddleware");
  });
  it("authorizes the trusted user parent before accessing any application or credential", async () => {
    const guard = await service.prepareCreate("actor", request);
    expect(guard.action).toBe("quyan:auth_center:CreateClient");
    expect(guard.users.users.map((u) => u.id).sort()).toEqual(["actor", "owner"]);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:auth_center:CreateClient", resource: "acs:quyan:*:owner:user/actor" }),
    );
    expect(repo.target).not.toHaveBeenCalled();
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("denies creation before loading snapshot data and rechecks the grant at commit", async () => {
    iam.authorize.mockResolvedValueOnce({ decision: "ExplicitDeny" });
    await expect(service.prepareCreate("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(users.targets).not.toHaveBeenCalled();
    const guard = await service.prepareCreate("actor", request);
    iam.authorize.mockResolvedValue({ decision: "ImplicitDeny" });
    await expect(guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed when authenticated user versions cannot be loaded completely", async () => {
    users.targets.mockResolvedValue([]);
    await expect(service.prepareCreate("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
});
