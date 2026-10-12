import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/platform-oauth-client.repository", () => ({
  PlatformOAuthClientRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/platform-oauth-client-mutation.repository", () => ({
  PlatformOAuthClientMutationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    IamAccountUserRepository: { getInstance: vi.fn() },
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { PlatformOAuthClientMutationIamService } from "@/services/users/platform-oauth-client-mutation-iam.service";
import { platformOAuthClientResourceResolver } from "@/iam/request/platform-oauth-resource-resolvers";
import { getIamActionDefinition, Permission, iamActionsForLegacyPermission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const target = {
  id: "system-app",
  userId: "different-owner",
  status: 1,
  isSystemClient: true,
  createTime: new Date(0),
  updateTime: new Date(0),
};
let service: PlatformOAuthClientMutationIamService, iam: any, repo: any, mutations: any, request: TypedRequest;
beforeEach(() => {
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorize: vi.fn().mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] }),
  };
  repo = {
    groupSnapshot: vi.fn().mockResolvedValue({ id: "global-group", updateTime: new Date(0) }),
    target: vi.fn().mockResolvedValue(target),
    hydrate: vi.fn().mockResolvedValue([{ ...target, name: "fixture" }]),
  };
  mutations = { update: vi.fn().mockResolvedValue({ ...target, name: "updated" }) };
  service = new (PlatformOAuthClientMutationIamService as unknown as new (
    ...args: any[]
  ) => PlatformOAuthClientMutationIamService)(
    iam,
    repo,
    {
      targets: vi
        .fn()
        .mockImplementation(async (_: any, ids: string[]) => ids.map((id) => ({ id, updateTime: new Date(0) }))),
    },
    mutations,
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { id: "system-app" },
    body: { accountId: "foreign" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("system OAuth application update authorization", () => {
  it("declares a platform action and resolver that never uses client account or action input", async () => {
    const action = "quyan:oauth:UpdateSystemClient";
    expect(getIamActionDefinition(action)).toMatchObject({
      sensitive: true,
      authorizationBoundary: "platform",
      resourceTypes: ["platform/oauth-client"],
    });
    expect(iamActionsForLegacyPermission(Permission.OAUTH_CLIENT_SYSTEM_MANAGE)).toContain(action);
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/users/oauth-client.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (r) => r.key === "PUT /v1/oauth-clients/system/{id}",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
    expect(
      await platformOAuthClientResourceResolver({
        request,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBe("acs:platform:*:platform:oauth-client/system-app");
  });
  it("locks trusted actor identities independently of the system application's creator", async () => {
    const prepared = await service.prepareUpdate("actor", "system-app", request);
    expect(prepared!.guard.users.users.map((u) => u.id).sort()).toEqual(["actor", "owner"]);
    expect(prepared!.guard.target.userId).toBe("different-owner");
    expect(prepared!.guard.group.id).toBe("global-group");
    await service.update({ name: "updated" }, prepared!.guard);
    expect(mutations.update).toHaveBeenCalled();
  });
  it("does not hydrate on Deny and rechecks current policy inside the mutation guard", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(service.prepareUpdate("actor", "system-app", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.hydrate).not.toHaveBeenCalled();
    iam.authorize.mockResolvedValue({ decision: "Allow" });
    const prepared = await service.prepareUpdate("actor", "system-app", request);
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(prepared!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("diagnoses metadata only and rejects ordinary resources or stale display data", async () => {
    await service.prepareUpdate("actor", "system-app", request, false);
    expect(repo.hydrate).not.toHaveBeenCalled();
    repo.target.mockResolvedValue({ ...target, isSystemClient: false });
    await expect(service.prepareUpdate("actor", "system-app", request)).rejects.toMatchObject({ statusCode: 403 });
    repo.target.mockResolvedValue(target);
    repo.hydrate.mockResolvedValue([{ ...target, updateTime: new Date(1) }]);
    await expect(service.prepareUpdate("actor", "system-app", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects missing identity, impersonated callers, OAuth tokens and unresolved resource IDs", async () => {
    await expect(service.prepareUpdate("actor", "system-app")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepareUpdate("other", "system-app", request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepareUpdate("actor", "../app", request)).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "token" } as any;
    await expect(service.prepareUpdate("actor", "system-app", request)).rejects.toMatchObject({ statusCode: 403 });
  });
});
