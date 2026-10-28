import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/users/platform-oauth-client.repository", () => ({
  PlatformOAuthClientRepository: { getInstance: vi.fn() },
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
import { PlatformOAuthClientIamService } from "@/services/users/platform-oauth-client-iam.service";
import type { TypedRequest } from "@/types/express";
const target = (id = "client") => ({
    id,
    userId: "platform-creator",
    status: 1,
    isSystemClient: true,
    createTime: new Date(0),
    updateTime: new Date(0),
  }),
  allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
let service: PlatformOAuthClientIamService, iam: any, repo: any, request: TypedRequest;
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
  service = new (PlatformOAuthClientIamService as unknown as new (...args: any[]) => PlatformOAuthClientIamService)(
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
describe("platform OAuth application list", () => {
  it("uses actual system records with the platform namespace, independent of the creator's account", async () => {
    expect(await service.list(request)).toHaveLength(1);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:oauth:ListSystemClients",
        resources: ["acs:platform:*:platform:oauth-client/client"],
      }),
    );
  });
  it("filters Deny before hydration and rechecks policy before returning fields", async () => {
    repo.scan.mockResolvedValue([target("a"), target("b")]);
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (r.endsWith("/b") ? deny : allow)),
    );
    expect((await service.list(request)).map((r) => r.id)).toEqual(["a"]);
    expect(repo.hydrate).toHaveBeenCalledWith(expect.anything(), [target("a")]);
    iam.authorizeMany.mockResolvedValueOnce([allow, allow]).mockResolvedValue([deny, deny]);
    expect(await service.list(request)).toEqual([]);
  });
  it("rejects ordinary records, bad cursor order and unrelated hydration", async () => {
    for (const batch of [[{ ...target(), isSystemClient: false }], [target("b"), target("a")]]) {
      repo.scan.mockResolvedValue(batch);
      await expect(service.list(request)).rejects.toMatchObject({ statusCode: 403 });
    }
    repo.scan.mockResolvedValue([target()]);
    repo.hydrate.mockResolvedValue([target("foreign")]);
    await expect(service.list(request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("cannot read after membership revocation, through OAuth scope tokens or without identity", async () => {
    await expect(service.list()).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "token" } as any;
    await expect(service.list(request)).rejects.toMatchObject({ statusCode: 403 });
    delete request.oauthAccessToken;
    repo.assertActor.mockResolvedValueOnce(undefined).mockRejectedValue(new Error("fixture membership revoked"));
    await expect(service.list(request)).rejects.toThrow("fixture membership revoked");
  });
  it("shadow diagnostics never hydrate display or secret fields", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await service.diagnose(request);
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
});
