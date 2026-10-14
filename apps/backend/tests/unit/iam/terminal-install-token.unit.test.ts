import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { TerminalInstallTokenIamService } from "@/services/remote-terminal/terminal-install-token-iam.service";
import { terminalInstallTokenResource } from "@/iam/request/terminal-install-token-resource-resolver";
import { remoteTerminalProductEntitlementArn } from "@/iam/resources/remote-terminal-resources";
import { TERMINAL_INSTALL_TARGET_SELECT } from "@/store/remote-terminal-product/terminal-install-token.repository";
import { verifyInstallToken } from "@/modules/remote-terminal/install-token";
import { IAM_AUTHENTICATED_SELF_ACTIONS, getIamActionDefinition, type IamPrincipal } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { authorize: vi.fn(), loadPolicies: vi.fn() },
  repository = { target: vi.fn(), issue: vi.fn() },
  users = { targets: vi.fn() },
  legacy = vi.fn();
const service = new TerminalInstallTokenIamService(iam, repository, users);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake" },
    body: { userId: "other", entitlementId: "other" },
    params: { id: "entitlement" },
    ip: "192.0.2.42",
    secure: true,
  }) as unknown as TypedRequest;
const mode = env.security.iamAuthorizationMode,
  originalSecret = env.integrations.remoteTerminal.installTokenSecret;
const FIXTURE_SECRET = "fixture-only-install-secret-".repeat(4);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  env.integrations.remoteTerminal.installTokenSecret = FIXTURE_SECRET;
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "fixture", matchedStatements: [] });
  users.targets.mockResolvedValue([
    { id: "actor", updateTime: new Date(0) },
    { id: "owner", updateTime: new Date(0) },
  ]);
  repository.target.mockResolvedValue({
    id: "entitlement",
    userId: "actor",
    status: 1,
    deviceLimit: 2,
    updateTime: new Date(0),
  });
  repository.issue.mockImplementation(async (_target, guard, generate) => {
    await guard.users.recheck();
    const result = await generate();
    await guard.users.recheck();
    return result;
  });
  legacy.mockResolvedValue({ token: "legacy-fixture", expiresAt: "2026-10-15T00:00:00Z" });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  env.integrations.remoteTerminal.installTokenSecret = originalSecret;
  vi.restoreAllMocks();
});
describe("install token entitlement authority", () => {
  it("declares the real entitlement resource and self capability without selecting existing credentials", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(
      routes.find((route) => route.key === "GET /v1/remote-terminal/products/me/entitlements/{id}/install-token"),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:remote_terminal:GetMyInstallToken"], issues: [] });
    expect(getIamActionDefinition("quyan:remote_terminal:GetMyInstallToken")).toMatchObject({
      resourceTypes: ["remote-terminal/product-entitlement"],
      sensitive: true,
      defaultAuthorizationScope: "self",
    });
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).toContain("quyan:remote_terminal:GetMyInstallToken");
    expect(Object.keys(TERMINAL_INSTALL_TARGET_SELECT)).toEqual([
      "id",
      "userId",
      "status",
      "deviceLimit",
      "updateTime",
    ]);
  });
  it("signs only after fixed-action entitlement admission and preserves the token protocol", async () => {
    const req = request();
    const result = await service.issue("actor", "entitlement", req, legacy);
    expect(verifyInstallToken(result.token, FIXTURE_SECRET)).toEqual({ entitlementId: "entitlement" });
    expect(iam.authorize.mock.calls[0][0]).toMatchObject({
      action: "quyan:remote_terminal:GetMyInstallToken",
      resource: remoteTerminalProductEntitlementArn("owner", "actor", "entitlement"),
    });
    expect(iam.authorize.mock.invocationCallOrder[0]).toBeLessThan(repository.target.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(req.iamDecisions)).not.toContain(result.token);
    expect(legacy).not.toHaveBeenCalled();
  });
  it("refuses explicit denial before loading entitlement metadata", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] });
    await expect(service.issue("actor", "entitlement", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
    expect(repository.issue).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("refuses wrong ownership and fabricated subject IDs", async () => {
    repository.target.mockResolvedValue({ id: "entitlement", userId: "other" });
    await expect(service.issue("actor", "entitlement", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.issue("other", "entitlement", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses policy revocation during the signing boundary", async () => {
    repository.issue.mockImplementation(async (_target, guard) => {
      iam.loadPolicies.mockResolvedValue([
        { policyId: "changed", document: { Version: "1", Statement: { Effect: "Deny", Action: "*", Resource: "*" } } },
      ]);
      await guard.users.recheck();
    });
    await expect(service.issue("actor", "entitlement", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not return a generated token when the final live-condition check denies", async () => {
    repository.issue.mockImplementation(async (_target, guard, generate) => {
      await guard.users.recheck();
      await generate();
      iam.authorize.mockResolvedValue({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] });
      await guard.users.recheck();
    });
    await expect(service.issue("actor", "entitlement", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects signing with insufficient secret configuration", async () => {
    env.integrations.remoteTerminal.installTokenSecret = "fixture-too-short";
    await expect(service.issue("actor", "entitlement", request(), legacy)).rejects.toThrow("RTM_INSTALL_TOKEN_SECRET");
  });
  it.each(["legacy", "shadow"] as const)("retains %s legacy enforcement on native refusal", async (value) => {
    env.security.iamAuthorizationMode = value;
    iam.authorize.mockRejectedValue(new Error("fixture unavailable"));
    expect((await service.issue("actor", "entitlement", request(), legacy)).token).toBe("legacy-fixture");
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("rejects malformed IDs, missing identity, OAuth and unknown mode", async () => {
    await expect(service.issue("actor", "../entitlement", request(), legacy)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.issue("actor", "entitlement", undefined, legacy)).rejects.toMatchObject({ statusCode: 403 });
    const oauth = request();
    oauth.oauthAccessToken = {} as typeof oauth.oauthAccessToken;
    await expect(service.issue("actor", "entitlement", oauth, legacy)).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "invalid" as typeof env.security.iamAuthorizationMode;
    await expect(service.issue("actor", "entitlement", request(), legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("constructs the account and user segments solely from trusted authentication", async () => {
    const context = {
      request: request(),
      principal: {
        subjectUserId: "actor",
        principalUserId: "actor",
        accountOwnerId: "owner",
        subjectType: "sub_user",
      } as IamPrincipal,
    };
    expect(await terminalInstallTokenResource(context)).toBe(
      remoteTerminalProductEntitlementArn("owner", "actor", "entitlement"),
    );
    context.request.params.id = "bad/id";
    expect(await terminalInstallTokenResource(context)).toBeUndefined();
  });
});
