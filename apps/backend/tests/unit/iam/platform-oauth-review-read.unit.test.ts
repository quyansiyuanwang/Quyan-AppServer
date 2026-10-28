import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/platform-oauth-review.repository", () => ({
  PlatformOAuthReviewRepository: { getInstance: vi.fn() },
}));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { env } from "@/config/env";
import { PlatformOAuthReviewIamService } from "@/services/users/platform-oauth-review-iam.service";
import type { TypedRequest } from "@/types/express";
const target = (id = "client") => ({
    id,
    userId: "platform-creator",
    status: 1,
    isSystemClient: false,
    submittedAt: null,
    createTime: new Date(0),
    updateTime: new Date(0),
  }),
  allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
let service: PlatformOAuthReviewIamService, iam: any, repo: any, request: TypedRequest;
beforeEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow)),
  };
  repo = {
    assertActor: vi.fn().mockResolvedValue(undefined),
    scan: vi.fn().mockResolvedValue([target()]),
    hydrate: vi
      .fn()
      .mockImplementation(async (_: any, targets: any[]) => targets.map((t) => ({ ...t, hasClientSecret: true }))),
    recheck: vi.fn().mockImplementation(async (_: any, targets: any[]) => targets),
  };
  service = new (PlatformOAuthReviewIamService as unknown as new (...args: any[]) => PlatformOAuthReviewIamService)(
    iam,
    repo,
    { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) },
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "actor" },
    headers: { "x-action": "*" },
  } as unknown as TypedRequest;
});
describe("platform OAuth review list", () => {
  it("uses review resources and passes server-normalized filters", async () => {
    const result = await service.list({ keyword: " app " }, request);
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:oauth:ListClientReviews",
        resources: ["acs:platform:*:platform:oauth-review-client/client"],
      }),
    );
    expect(repo.scan).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ keyword: "app" }), undefined);
  });
  it("filters Deny before pagination, hydration and authorized counts", async () => {
    repo.scan.mockResolvedValue([target("a"), target("b"), target("c")]);
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (r.endsWith("/b") ? deny : allow)),
    );
    const result = await service.list({ pageSize: 1 }, request);
    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.id)).toEqual(["c"]);
    expect(repo.hydrate).toHaveBeenCalledWith(expect.anything(), [target("c")]);
  });
  it("fails closed if grants or versions change after loading display fields", async () => {
    repo.hydrate.mockImplementation(async (_: any, targets: any[]) => {
      iam.authorizeMany.mockResolvedValue([deny]);
      return targets;
    });
    await expect(service.list({}, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects system apps, invalid cursor order and unrelated hydration", async () => {
    for (const batch of [[{ ...target(), isSystemClient: true }], [target("b"), target("a")]]) {
      repo.scan.mockResolvedValue(batch);
      await expect(service.list({}, request)).rejects.toMatchObject({ statusCode: 403 });
    }
    repo.scan.mockResolvedValue([target()]);
    repo.hydrate.mockResolvedValue([target("foreign")]);
    await expect(service.list({}, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects invalid query, OAuth tokens and missing identities", async () => {
    await expect(service.list({ pageSize: 101 }, request)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.list({})).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "token" } as any;
    await expect(service.list({}, request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("runs shadow diagnostics without fetching display data", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await service.diagnose({}, request);
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
});
