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
describe("personal auth center application lifecycle boundary", () => {
  it("registers separate sensitive rotation and review submission actions", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/users/auth-center-client.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [operation, route] of [
      ["RotateClientSecret", "POST /v1/auth-center/clients/{id}/regenerate-secret"],
      ["SubmitClientReview", "POST /v1/auth-center/clients/{id}/submit-review"],
    ]) {
      const action = "quyan:auth_center:" + operation;
      expect(getIamActionDefinition(action)).toMatchObject({
        sensitive: true,
        accessLevel: "Write",
        resourceTypes: ["auth-center/client"],
      });
      expect(getIamActionDefinition(action)?.defaultAuthorizationScope).toBeUndefined();
      expect(iamActionsForLegacyPermission(Permission.AUTH_CENTER_CLIENT_UPDATE)).toContain(action);
      expect(routes.find((r) => r.key === route)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
    }
  });
  it("requires the write action without requiring or borrowing a read action", async () => {
    const result = await service.prepare("quyan:auth_center:RotateClientSecret", "actor", "client", request);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:auth_center:RotateClientSecret",
        resource: "acs:auth-center:*:owner:client/actor/client",
      }),
    );
    expect(result?.existing).toMatchObject({ id: "client" });
    expect(result?.guard.action).toBe("quyan:auth_center:RotateClientSecret");
    await service.update({ clientSecretHash: "fixture-hash", clientSecretPreview: "fixture-preview" }, result!.guard);
    expect(mutations.update).toHaveBeenCalledWith(
      { clientSecretHash: "fixture-hash", clientSecretPreview: "fixture-preview" },
      result!.guard,
    );
  });
  it("never reads display data when denied and never writes during shadow preparation", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(
      service.prepare("quyan:auth_center:RotateClientSecret", "actor", "client", request),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repo.hydrate).not.toHaveBeenCalled();
    iam.authorize.mockResolvedValue({ decision: "Allow" });
    await service.prepare("quyan:auth_center:SubmitClientReview", "actor", "client", request, false);
    expect(repo.hydrate).not.toHaveBeenCalled();
    expect(mutations.update).not.toHaveBeenCalled();
  });
  it("captures user/account versions and rechecks the policy inside the write guard", async () => {
    const prepared = await service.prepare("quyan:auth_center:RotateClientSecret", "actor", "client", request);
    expect(prepared!.guard.users.users.map((u) => u.id).sort()).toEqual(["actor", "owner"]);
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(prepared!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects another owner, inactive clients, stale hydration and unavailable snapshots", async () => {
    for (const row of [
      { ...target, userId: "peer" },
      { ...target, status: 0 },
    ]) {
      repo.target.mockResolvedValue(row);
      await expect(
        service.prepare("quyan:auth_center:RotateClientSecret", "actor", "client", request),
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    repo.target.mockResolvedValue(target);
    repo.hydrate.mockResolvedValue([{ ...target, updateTime: new Date(1) }]);
    await expect(
      service.prepare("quyan:auth_center:RotateClientSecret", "actor", "client", request),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    users.targets.mockResolvedValue([]);
    await expect(
      service.prepare("quyan:auth_center:RotateClientSecret", "actor", "client", request),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mutations.update).not.toHaveBeenCalled();
  });
  it("registers separate rotation and deletion actions and uses their resource guards", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/users/auth-center-client.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [action, route, permission] of [
      [
        "quyan:auth_center:RotateClientSecret",
        "POST /v1/auth-center/clients/{id}/regenerate-secret",
        Permission.AUTH_CENTER_CLIENT_UPDATE,
      ],
      ["quyan:auth_center:DeleteClient", "DELETE /v1/auth-center/clients/{id}", Permission.AUTH_CENTER_CLIENT_DELETE],
    ] as const) {
      expect(getIamActionDefinition(action)).toMatchObject({
        sensitive: true,
        resourceTypes: ["auth-center/client"],
        accessLevel: "Write",
      });
      expect(iamActionsForLegacyPermission(permission)).toContain(action);
      expect(routes.find((r) => r.key === route)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
      await service.prepare(action, "actor", "client", request);
      expect(iam.authorize).toHaveBeenLastCalledWith(
        expect.objectContaining({ action, resource: "acs:auth-center:*:owner:client/actor/client" }),
      );
    }
  });
});
