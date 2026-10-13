import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: vi.fn() }), LogCategory: { SECURITY: "security" } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/auth/email.service", () => ({ EmailService: { getInstance: () => email } }));
vi.mock("@/services/system/businesslog.service", () => ({ default: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { Permission, iamActionsForLegacyPermission } from "@quyan/shared";
import { env } from "@/config/env";
import { UserEmailIamService } from "@/services/users/user-email-iam.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import type { TypedRequest } from "@/types/express";
const email = { sendVerificationCode: vi.fn(), verifyCode: vi.fn() },
  iam = { loadPolicies: vi.fn(), authorize: vi.fn() },
  repository = { emailSnapshot: vi.fn(), recheckEmail: vi.fn(), updateEmail: vi.fn() },
  users = { findById: vi.fn(), findByEmailInNonDeleted: vi.fn() },
  logs = { findRecentSuccessfulOperation: vi.fn() },
  audit = { logOperation: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new UserEmailIamService(iam, repository, users, logs, audit, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    params: { userId: "peer" },
    query: { accountOwnerId: "foreign" },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.1",
  }) as unknown as TypedRequest;
const data = { newEmail: "new@example.test", verificationCode: "123456" };
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] });
  repository.emailSnapshot.mockResolvedValue({ target: { id: "actor", updateTime: new Date(0) }, revision: "fixture" });
  repository.recheckEmail.mockImplementation(async (_identity, _snapshot, recheck) => recheck());
  repository.updateEmail.mockImplementation(async (_identity, _snapshot, _email, recheck) => recheck());
  users.findById.mockResolvedValue({ id: "actor", username: "alice", email: "old@example.test" });
  users.findByEmailInNonDeleted.mockResolvedValue(null);
  logs.findRecentSuccessfulOperation.mockResolvedValue(null);
  email.verifyCode.mockResolvedValue(true);
  email.sendVerificationCode.mockResolvedValue(undefined);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
});
describe("native email changes use the authenticated user's resource", () => {
  it("projects the old email permission to both independent actions", () => {
    expect(iamActionsForLegacyPermission(Permission.USER_UPDATE_SELF_EMAIL)).toEqual(
      expect.arrayContaining(["quyan:user:SendEmailChangeCode", "quyan:user:ChangeEmail"]),
    );
  });
  it("authorizes a fixed action and own ARN before dispatching one verification message", async () => {
    const req = request();
    await service.send("actor", data.newEmail, req);
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:user:SendEmailChangeCode", resource: "acs:quyan:*:owner:user/actor" }),
    );
    expect(repository.recheckEmail).toHaveBeenCalledTimes(1);
    expect(email.sendVerificationCode).toHaveBeenCalledExactlyOnceWith(data.newEmail);
    expect(repository.updateEmail).not.toHaveBeenCalled();
  });
  it("verifies the code then writes through the guarded repository and logs one success", async () => {
    await service.change("actor", data, request());
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quyan:user:ChangeEmail", resource: "acs:quyan:*:owner:user/actor" }),
    );
    expect(repository.updateEmail).toHaveBeenCalledWith(
      expect.objectContaining({ principal: expect.objectContaining({ accountOwnerId: "owner" }) }),
      expect.objectContaining({ revision: "fixture" }),
      data.newEmail,
      expect.any(Function),
    );
    expect(audit.logOperation).toHaveBeenCalledTimes(1);
  });
  it("never reads user data or sends mail under matching Deny", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] });
    await expect(service.send("actor", data.newEmail, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.change("actor", data, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(users.findById).not.toHaveBeenCalled();
    expect(email.sendVerificationCode).not.toHaveBeenCalled();
    expect(email.verifyCode).not.toHaveBeenCalled();
  });
  it("fails closed when policy reads are unavailable", async () => {
    iam.loadPolicies.mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.change("actor", data, request())).rejects.toThrow("fixture unavailable");
    expect(repository.updateEmail).not.toHaveBeenCalled();
  });
  it("refuses peers, missing context, read-only impersonation and unknown mode", async () => {
    await expect(service.change("peer", data, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.change("actor", data)).rejects.toMatchObject({ statusCode: 403 });
    const req = request();
    req.user = { ...req.user!, impersonatorId: "admin", impersonationMode: "view" };
    await expect(service.change("actor", data, req)).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "invalid" as never;
    await expect(service.change("actor", data, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.emailSnapshot).not.toHaveBeenCalled();
  });
  it("requires email scope and forwards live OAuth identity to the repository", async () => {
    const req = request();
    req.oauthAccessToken = { id: "token", userId: "actor", oauthClientId: "client", scopes: ["profile"] } as never;
    await expect(service.send("actor", data.newEmail, req)).rejects.toMatchObject({ statusCode: 403 });
    req.oauthAccessToken = { id: "token", userId: "actor", oauthClientId: "client", scopes: ["email"] } as never;
    await service.send("actor", data.newEmail, req);
    expect(repository.emailSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ oauth: { id: "token", clientId: "client", scope: "email" } }),
    );
  });
  it.each(["same", "taken", "recent"])("preserves %s business validation before mail or code use", async (kind) => {
    if (kind === "same") users.findById.mockResolvedValue({ id: "actor", email: data.newEmail });
    if (kind === "taken") users.findByEmailInNonDeleted.mockResolvedValue({ id: "peer" });
    if (kind === "recent") logs.findRecentSuccessfulOperation.mockResolvedValue({ id: "log" });
    await expect(service.send("actor", data.newEmail, request())).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.change("actor", data, request())).rejects.toMatchObject({ statusCode: 400 });
    expect(email.verifyCode).not.toHaveBeenCalled();
    expect(email.sendVerificationCode).not.toHaveBeenCalled();
  });
  it("invalid verification does not update or log success", async () => {
    email.verifyCode.mockResolvedValue(false);
    await expect(service.change("actor", data, request())).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.updateEmail).not.toHaveBeenCalled();
    expect(audit.logOperation).not.toHaveBeenCalled();
  });
  it("rechecks the IAM decision after code verification before any write", async () => {
    email.verifyCode.mockImplementation(async () => {
      iam.authorize.mockResolvedValue({ decision: "ImplicitDeny", reason: "no-matching-allow", matchedStatements: [] });
      return true;
    });
    await expect(service.change("actor", data, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(audit.logOperation).not.toHaveBeenCalled();
  });
  it("does not send mail if the final identity/revision check fails", async () => {
    repository.recheckEmail.mockRejectedValue(new Error("fixture changed"));
    await expect(service.send("actor", data.newEmail, request())).rejects.toThrow("fixture changed");
    expect(email.sendVerificationCode).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves old permission in %s without a native fallback write",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      iam.authorize.mockResolvedValue({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] });
      await service.change("actor", data, request());
      expect(repository.updateEmail).toHaveBeenCalledTimes(1);
      permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
      await expect(service.send("actor", data.newEmail, request())).rejects.toMatchObject({ statusCode: 403 });
      expect(email.sendVerificationCode).not.toHaveBeenCalled();
    },
  );
  it("rejects malformed or unknown body fields without accessing authorization data", async () => {
    await expect(service.change("actor", { ...data, permissionAdds: ["*"] } as never, request())).rejects.toMatchObject(
      { statusCode: 400 },
    );
    await expect(service.send("actor", "not-email", request())).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.emailSnapshot).not.toHaveBeenCalled();
  });
  it("IAM audit does not include email contents, verification code or policy JSON", async () => {
    await service.change("actor", data, request());
    const emitted = JSON.stringify(vi.mocked(auditIamDecision).mock.calls);
    expect(emitted).not.toContain(data.newEmail);
    expect(emitted).not.toContain(data.verificationCode);
    expect(emitted).not.toContain('"Statement":');
  });
});
