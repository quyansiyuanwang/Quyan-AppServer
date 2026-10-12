import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/platform-oauth-review-mutation.repository", () => ({
  PlatformOAuthReviewMutationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    IamAccountUserRepository: { getInstance: vi.fn() },
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { PlatformOAuthReviewMutationIamService } from "@/services/users/platform-oauth-review-mutation-iam.service";
import { platformOAuthReviewClientResourceResolver } from "@/iam/request/platform-oauth-resource-resolvers";
import { getIamActionDefinition, Permission, iamActionsForLegacyPermission } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const target = {
  id: "system-app",
  userId: "different-owner",
  status: 1,
  isSystemClient: false,
  submittedAt: null,
  reviewStatus: "pending",
  createTime: new Date(0),
  updateTime: new Date(0),
};
let service: PlatformOAuthReviewMutationIamService, iam: any, repo: any, request: TypedRequest;
beforeEach(() => {
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorize: vi.fn().mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] }),
  };
  repo = {
    groupSnapshot: vi.fn().mockResolvedValue({ id: "global-group", updateTime: new Date(0) }),
    target: vi.fn().mockResolvedValue(target),
    hydrate: vi.fn().mockResolvedValue({ ...target, name: "fixture" }),
    mutate: vi.fn().mockResolvedValue({ ...target, reviewStatus: "approved" }),
  };
  service = new (PlatformOAuthReviewMutationIamService as unknown as new (
    ...args: any[]
  ) => PlatformOAuthReviewMutationIamService)(iam, repo, {
    targets: vi
      .fn()
      .mockImplementation(async (_: any, ids: string[]) => ids.map((id) => ({ id, updateTime: new Date(0) }))),
  });
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { id: "system-app" },
    body: { accountId: "foreign" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("platform OAuth review mutations", () => {
  it("declares distinct sensitive actions on the real platform review resource", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/users/oauth-client.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [verb, operation] of [
      ["POST", "ReviewClient"],
      ["DELETE", "DeleteReviewedClient"],
    ]) {
      const action = "quyan:oauth:" + operation;
      expect(getIamActionDefinition(action)).toMatchObject({
        sensitive: true,
        authorizationBoundary: "platform",
        resourceTypes: ["platform/oauth-review-client"],
      });
      expect(iamActionsForLegacyPermission(Permission.OAUTH_CLIENT_REVIEW_UPDATE)).toContain(action);
      expect(routes.find((r) => r.key === verb + " /v1/oauth-clients/{id}/review")).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
    }
    expect(
      await platformOAuthReviewClientResourceResolver({
        request,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBe("acs:platform:*:platform:oauth-review-client/system-app");
    const prepared = await service.prepare("quyan:oauth:ReviewClient", "actor", "system-app", request);
    expect(prepared!.guard.users.users.map((u) => u.id).sort()).toEqual(["actor", "owner"]);
    expect(prepared!.existing.userId).toBe("different-owner");
  });
  it("never hydrates on Deny and rechecks policy within the guard", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(service.prepare("quyan:oauth:ReviewClient", "actor", "system-app", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repo.hydrate).not.toHaveBeenCalled();
    iam.authorize.mockResolvedValue({ decision: "Allow" });
    const prepared = await service.prepare("quyan:oauth:DeleteReviewedClient", "actor", "system-app", request);
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
    await expect(prepared!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects system apps, stale hydration and untrusted identity", async () => {
    repo.target.mockResolvedValue({ ...target, isSystemClient: true });
    await expect(service.prepare("quyan:oauth:ReviewClient", "actor", "system-app", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    repo.target.mockResolvedValue(target);
    repo.hydrate.mockResolvedValue({ ...target, updateTime: new Date(1) });
    await expect(service.prepare("quyan:oauth:ReviewClient", "actor", "system-app", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.prepare("quyan:oauth:ReviewClient", "foreign", "system-app", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    request.oauthAccessToken = { id: "token" } as any;
    await expect(service.prepare("quyan:oauth:ReviewClient", "actor", "system-app", request)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("prepares only metadata for shadow and never mutates", async () => {
    await service.prepare("quyan:oauth:ReviewClient", "actor", "system-app", request, false);
    expect(repo.hydrate).not.toHaveBeenCalled();
    expect(repo.mutate).not.toHaveBeenCalled();
  });
});
