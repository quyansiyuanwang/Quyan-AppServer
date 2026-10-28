import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/oauth-client-management.repository", () => ({
  OAuthClientManagementRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { OAuthClientIamService } from "@/services/users/oauth-client-iam.service";
import { oauthClientResourceResolver } from "@/iam/request/oauth-client-resource-resolvers";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { Project } from "ts-morph";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
const target = (id = "client") => ({
  id,
  userId: "actor",
  status: 1,
  isSystemClient: false,
  createTime: new Date(0),
  updateTime: new Date(0),
});
let iam: any, repo: any, service: OAuthClientIamService, request: TypedRequest;
beforeEach(() => {
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow)),
  };
  repo = {
    assertActor: vi.fn().mockResolvedValue(undefined),
    scan: vi.fn().mockResolvedValue([target()]),
    target: vi.fn().mockResolvedValue(target()),
    hydrate: vi
      .fn()
      .mockImplementation(async (_: any, targets: any[]) =>
        targets.map((t) => ({ ...t, name: "fixture", hasClientSecret: true })),
      ),
    recheck: vi.fn().mockImplementation(async (_: any, targets: any[]) => targets),
  };
  service = new (OAuthClientIamService as unknown as new (...args: any[]) => OAuthClientIamService)(iam, repo);
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { id: "client" },
    headers: { "x-action": "*" },
    body: { accountOwnerId: "foreign" },
  } as unknown as TypedRequest;
});
describe("personal OAuth client resource reads", () => {
  it("registers distinct List/Get actions with no automatic self grants", () => {
    for (const operation of ["ListClients", "GetClient"]) {
      expect(getIamActionDefinition("quyan:oauth:" + operation)).toMatchObject({
        resourceTypes: ["oauth/client"],
        authorizationStage: "declared",
      });
      expect(getIamActionDefinition("quyan:oauth:" + operation)?.defaultAuthorizationScope).toBeUndefined();
      expect(iamActionsForLegacyPermission(Permission.OAUTH_CLIENT_READ)).toContain("quyan:oauth:" + operation);
    }
  });
  it("declares both endpoints with fixed server actions", () => {
    const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/users/oauth-client.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.key === "GET /v1/oauth-clients")?.actions[0]).toBe("quyan:oauth:ListClients");
    expect(routes.find((r) => r.key === "GET /v1/oauth-clients/{id}")?.actions[0]).toBe("quyan:oauth:GetClient");
  });
  it("uses the trusted account and record owner regardless of client action headers", async () => {
    expect(
      await oauthClientResourceResolver({
        request,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBe("acs:oauth:*:owner:client/actor/client");
    await service.get("actor", "client", request);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:oauth:GetClient",
        resources: ["acs:oauth:*:owner:client/actor/client"],
      }),
    );
  });
  it("filters denied list records before hydrating display data", async () => {
    repo.scan.mockResolvedValue([target("z"), target("a")]);
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (r.endsWith("/z") ? deny : allow)),
    );
    expect((await service.list("actor", request)).map((r) => r.id)).toEqual(["a"]);
    expect(repo.hydrate).toHaveBeenCalledWith(expect.anything(), [target("a")]);
  });
  it("denies details without fetching fields when an explicit Deny matches", async () => {
    iam.authorizeMany.mockResolvedValue([deny]);
    await expect(service.get("actor", "client", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("drops records whose list authorization was revoked during hydration", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValue([deny]);
    expect(await service.list("actor", request)).toEqual([]);
  });
  it("refuses a stale detail snapshot and rechecks account identity", async () => {
    repo.target.mockResolvedValueOnce(target()).mockResolvedValue({ ...target(), updateTime: new Date(1) });
    await expect(service.get("actor", "client", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.assertActor).toHaveBeenCalled();
  });
  it("rejects peers, platform clients and incomplete evaluator output", async () => {
    for (const row of [
      { ...target(), userId: "peer" },
      { ...target(), isSystemClient: true },
    ]) {
      repo.target.mockResolvedValue(row);
      await expect(service.get("actor", "client", request)).rejects.toMatchObject({ statusCode: 403 });
    }
    repo.target.mockResolvedValue(target());
    iam.authorizeMany.mockResolvedValue([]);
    await expect(service.get("actor", "client", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("rejects missing or inconsistent authentication and malformed resource identifiers", async () => {
    await expect(service.list("actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.get("actor", "../client", request)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("peer", request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps shadow diagnostics on metadata and never hydrates", async () => {
    await service.diagnoseList("actor", request);
    await service.get("actor", "client", request, false);
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("checks OAuth scope, expiry and token user, passing exact token identity", async () => {
    request.oauthAccessToken = {
      id: "token",
      oauthClientId: "login",
      userId: "actor",
      scopes: ["oauth_client"],
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    } as any;
    await service.list("actor", request);
    expect(repo.assertActor).toHaveBeenCalledWith(
      expect.objectContaining({ oauth: { id: "token", clientId: "login" } }),
    );
    for (const invalid of [{ scopes: ["profile"] }, { userId: "peer" }, { expiresAt: "invalid" }]) {
      const token = { ...request.oauthAccessToken };
      Object.assign(request.oauthAccessToken!, invalid);
      await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
      request.oauthAccessToken = token as any;
    }
  });
  it("fails closed on invalid list ownership, order and unselected hydration", async () => {
    repo.scan.mockResolvedValue([target("a"), target("z")]);
    await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    repo.scan.mockResolvedValue([target()]);
    repo.hydrate.mockResolvedValue([target("unselected")]);
    await expect(service.list("actor", request)).rejects.toMatchObject({ statusCode: 403 });
  });
});
