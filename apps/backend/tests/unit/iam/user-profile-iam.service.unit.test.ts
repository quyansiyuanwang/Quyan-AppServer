import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  Permission,
  getIamActionDefinition,
  iamActionsForLegacyPermission,
  IAM_AUTHENTICATED_SELF_ACTIONS,
} from "@quyan/shared";
import { env } from "@/config/env";
import { UserProfileIamService } from "@/services/users/user-profile-iam.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import type { TypedRequest } from "@/types/express";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service");
vi.mock("@/services/users/permission.service");
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
const mode = env.security.iamAuthorizationMode;
let request: TypedRequest, iam: any, repo: any, permissions: any, service: UserProfileIamService;
beforeEach(() => {
  vi.clearAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    params: { userId: "peer" },
    query: { accountOwnerId: "foreign", userId: "peer" },
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
    secure: true,
  } as unknown as TypedRequest;
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorize: vi.fn().mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] }),
  };
  repo = {
    target: vi.fn().mockResolvedValue({ id: "actor", updateTime: new Date(0) }),
    hydrate: vi.fn().mockResolvedValue({ id: "actor", username: "fixture" }),
    update: vi.fn().mockResolvedValue({ id: "actor", name: "updated" }),
  };
  permissions = { checkUserPermissions: vi.fn().mockResolvedValue({ hasPermission: true }) };
  service = new (UserProfileIamService as any)(iam, repo, permissions);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("native personal profile resource authorization", () => {
  it("grants only the read capability by catalog self default", () => {
    expect(getIamActionDefinition("quyan:user:GetCurrentUser")).toMatchObject({
      resourceTypes: ["quyan/user"],
      defaultAuthorizationScope: "self",
      accessLevel: "Read",
    });
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).toContain("quyan:user:GetCurrentUser");
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain("quyan:user:UpdateProfile");
    expect(iamActionsForLegacyPermission(Permission.USER_UPDATE_SELF_PROFILE)).toContain("quyan:user:UpdateProfile");
  });
  it("authorizes the actual user then hydrates only the matched snapshot", async () => {
    expect(await service.get("actor", request)).toEqual({ id: "actor", username: "fixture" });
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:user:GetCurrentUser", resource: "acs:quyan:*:owner:user/actor" }),
    );
    expect(repo.hydrate).toHaveBeenCalledWith(
      expect.objectContaining({ principal: expect.objectContaining({ accountOwnerId: "owner" }) }),
      expect.objectContaining({ id: "actor" }),
    );
  });
  it("never hydrates or writes after Deny or malformed decisions", async () => {
    for (const decision of [{ decision: "ExplicitDeny" }, undefined]) {
      iam.authorize.mockResolvedValue(decision);
      await expect(service.get("actor", request)).rejects.toMatchObject({ statusCode: 403 });
      await expect(service.update("actor", { name: "sensitive-fixture-name" }, request)).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    expect(repo.hydrate).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
  it("rejects missing or mismatched trusted identities before any target read", async () => {
    await expect(service.get("actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.update("peer", {}, request)).rejects.toMatchObject({ statusCode: 403 });
    request.authContext!.principalUserId = "peer";
    await expect(service.get("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.target).not.toHaveBeenCalled();
  });
  it("passes only validated name changes, not client ownership or lifecycle fields", async () => {
    await service.update(
      "actor",
      { name: "sensitive-fixture-name", accountOwnerId: "foreign", status: -1, groupId: "foreign" },
      request,
    );
    expect(repo.update).toHaveBeenCalledWith(expect.anything(), expect.anything(), { name: "sensitive-fixture-name" });
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:user:UpdateProfile", resource: "acs:quyan:*:owner:user/actor" }),
    );
    expect(JSON.stringify(vi.mocked(auditIamDecision).mock.calls)).not.toContain("sensitive-fixture-name");
  });
  it("rejects invalid name input before touching storage", async () => {
    await expect(service.update("actor", { name: "x".repeat(51) }, request)).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.target).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "retains %s read behavior but still requires legacy update authority",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      iam.authorize.mockResolvedValue({ decision: "ExplicitDeny" });
      expect(await service.get("actor", request)).toMatchObject({ id: "actor" });
      permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
      await expect(service.update("actor", {}, request)).rejects.toMatchObject({ statusCode: 403 });
      expect(repo.update).not.toHaveBeenCalled();
    },
  );
  it("honors read-only impersonation independently of the HTTP guard", async () => {
    request.user = { ...request.user!, impersonatorId: "admin", impersonationMode: "view" };
    await expect(service.update("actor", { name: "blocked" }, request)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.target).not.toHaveBeenCalled();
    expect(await service.get("actor", request)).toMatchObject({ id: "actor" });
  });
  it("does not fall back to legacy on unavailable policy data in enforce", async () => {
    iam.loadPolicies.mockRejectedValue(new Error("fixture database failure"));
    await expect(service.get("actor", request)).rejects.toThrow();
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("accepts only this user's profile-scoped OAuth context and carries exact token identity", async () => {
    request.oauthAccessToken = {
      id: "oauth",
      oauthClientId: "client",
      userId: "actor",
      scopes: [Permission.USER_UPDATE_SELF_PROFILE],
    } as NonNullable<TypedRequest["oauthAccessToken"]>;
    await service.get("actor", request);
    expect(repo.target).toHaveBeenCalledWith(expect.objectContaining({ oauth: { id: "oauth", clientId: "client" } }));
    request.oauthAccessToken.userId = "peer";
    await expect(service.get("actor", request)).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken.userId = "actor";
    request.oauthAccessToken.scopes = ["email"];
    await expect(service.get("actor", request)).rejects.toMatchObject({ statusCode: 403 });
  });
});
