import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/services/users/oauth-client-iam.service", () => ({ OAuthClientIamService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/oauth-client-management.repository", () => ({
  OAuthClientManagementRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/oauth-client-mutation.repository", () => ({
  OAuthClientMutationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    IamAccountUserRepository: { getInstance: vi.fn() },
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { OAuthClientMutationIamService } from "@/services/users/oauth-client-mutation-iam.service";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { Project } from "ts-morph";
import type { TypedRequest } from "@/types/express";
const target = {
    id: "client",
    userId: "actor",
    status: 1,
    isSystemClient: false,
    createTime: new Date(0),
    updateTime: new Date(0),
  },
  principal = { subjectUserId: "actor", principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" };
let iam: any,
  reads: any,
  repo: any,
  users: any,
  mutations: any,
  service: OAuthClientMutationIamService,
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
  service = new (OAuthClientMutationIamService as unknown as new (...args: any[]) => OAuthClientMutationIamService)(
    iam,
    reads,
    repo,
    users,
    mutations,
  );
});
describe("personal OAuth application update boundary", () => {
  it("registers separate sensitive update and review submission actions", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/users/oauth-client.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [operation, route] of [
      ["UpdateClient", "PUT /v1/oauth-clients/{id}"],
      ["SubmitClientReview", "POST /v1/oauth-clients/{id}/submit-review"],
    ]) {
      const action = "quyan:oauth:" + operation;
      expect(getIamActionDefinition(action)).toMatchObject({
        sensitive: true,
        accessLevel: "Write",
        resourceTypes: ["oauth/client"],
      });
      expect(getIamActionDefinition(action)?.defaultAuthorizationScope).toBeUndefined();
      expect(iamActionsForLegacyPermission(Permission.OAUTH_CLIENT_UPDATE)).toContain(action);
      expect(routes.find((r) => r.key === route)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
    }
  });
  it("requires the write action without requiring or borrowing a read action", async () => {
    const result = await service.prepare("quyan:oauth:UpdateClient", "actor", "client", request);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:oauth:UpdateClient",
        resource: "acs:oauth:*:owner:client/actor/client",
      }),
    );
    expect(result?.existing).toMatchObject({ id: "client" });
    await service.update({ name: "updated" }, result!.guard);
    expect(mutations.update).toHaveBeenCalledWith({ name: "updated" }, result!.guard);
  });
  it("never reads display data when denied and never writes during shadow preparation", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(service.prepare("quyan:oauth:UpdateClient", "actor", "client", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repo.hydrate).not.toHaveBeenCalled();
    iam.authorize.mockResolvedValue({ decision: "Allow" });
    await service.prepare("quyan:oauth:SubmitClientReview", "actor", "client", request, false);
    expect(repo.hydrate).not.toHaveBeenCalled();
    expect(mutations.update).not.toHaveBeenCalled();
  });
  it("captures user/account versions and rechecks the policy inside the write guard", async () => {
    const prepared = await service.prepare("quyan:oauth:UpdateClient", "actor", "client", request);
    expect(prepared!.guard.users.users.map((u) => u.id).sort()).toEqual(["actor", "owner"]);
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(prepared!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects another owner, platform clients, stale hydration and unavailable snapshots", async () => {
    for (const row of [
      { ...target, userId: "peer" },
      { ...target, isSystemClient: true },
      { ...target, status: 0 },
    ]) {
      repo.target.mockResolvedValue(row);
      await expect(service.prepare("quyan:oauth:UpdateClient", "actor", "client", request)).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    repo.target.mockResolvedValue(target);
    repo.hydrate.mockResolvedValue([{ ...target, updateTime: new Date(1) }]);
    await expect(service.prepare("quyan:oauth:UpdateClient", "actor", "client", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    users.targets.mockResolvedValue([]);
    await expect(service.prepare("quyan:oauth:UpdateClient", "actor", "client", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mutations.update).not.toHaveBeenCalled();
  });
  it("registers separate rotation and deletion actions and uses their resource guards", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/users/oauth-client.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [action, route, permission] of [
      [
        "quyan:oauth:RotateClientSecret",
        "POST /v1/oauth-clients/{id}/regenerate-secret",
        Permission.OAUTH_CLIENT_UPDATE,
      ],
      ["quyan:oauth:DeleteClient", "DELETE /v1/oauth-clients/{id}", Permission.OAUTH_CLIENT_DELETE],
    ] as const) {
      expect(getIamActionDefinition(action)).toMatchObject({
        sensitive: true,
        resourceTypes: ["oauth/client"],
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
        expect.objectContaining({ action, resource: "acs:oauth:*:owner:client/actor/client" }),
      );
    }
  });
});
