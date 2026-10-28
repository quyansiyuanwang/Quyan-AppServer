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
describe("auth center client configuration updates", () => {
  it("declares a sensitive native action while retaining 2FA and replay middleware", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const source = project.addSourceFileAtPath("src/api/controllers/v1/users/auth-center-client.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.key === "PUT /v1/auth-center/clients/{id}")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:auth_center:UpdateClient"],
      issues: [],
    });
    expect(getIamActionDefinition("quyan:auth_center:UpdateClient")).toMatchObject({
      sensitive: true,
      resourceTypes: ["auth-center/client"],
      accessLevel: "Write",
    });
    expect(iamActionsForLegacyPermission(Permission.AUTH_CENTER_CLIENT_UPDATE)).toContain(
      "quyan:auth_center:UpdateClient",
    );
    const method = source.getClassOrThrow("AuthCenterClientController").getMethodOrThrow("updateClient");
    expect(method.getDecorator("TwoFactorChallengeProtected")).toBeDefined();
    const middleware = method
      .getDecorators()
      .filter((d) => d.getName() === "Middlewares")
      .map((d) => d.getText())
      .join(" ");
    expect(middleware).toContain("replayProtectionMiddleware");
    expect(middleware).toContain("twoFactorChallengeMiddleware");
  });
  it("uses the real client ARN and captures the matching write action", async () => {
    const prepared = await service.prepare("quyan:auth_center:UpdateClient", "actor", "client", request);
    expect(prepared!.guard.action).toBe("quyan:auth_center:UpdateClient");
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:auth_center:UpdateClient",
        resource: "acs:auth-center:*:owner:client/actor/client",
      }),
    );
    await service.update({ name: "updated" }, prepared!.guard);
    expect(mutations.update).toHaveBeenCalledWith({ name: "updated" }, prepared!.guard);
  });
  it("denies before reading safe display data and rechecks grants before committing", async () => {
    iam.authorize.mockResolvedValueOnce({ decision: "ExplicitDeny" });
    await expect(service.prepare("quyan:auth_center:UpdateClient", "actor", "client", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repo.hydrate).not.toHaveBeenCalled();
    const prepared = await service.prepare("quyan:auth_center:UpdateClient", "actor", "client", request);
    iam.authorize.mockResolvedValue({ decision: "ImplicitDeny" });
    await expect(prepared!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
    expect(mutations.update).not.toHaveBeenCalled();
  });
  it("cannot prepare a different owner or stale resource snapshot", async () => {
    repo.target.mockResolvedValueOnce({ ...target, userId: "peer" });
    await expect(service.prepare("quyan:auth_center:UpdateClient", "actor", "client", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    repo.hydrate.mockResolvedValue([{ ...target, updateTime: new Date(1) }]);
    await expect(service.prepare("quyan:auth_center:UpdateClient", "actor", "client", request)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
