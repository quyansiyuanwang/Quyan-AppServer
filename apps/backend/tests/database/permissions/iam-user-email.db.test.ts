import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, actionForPermission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { UserService } from "@/services/users/user.service";
import { EmailService } from "@/services/auth/email.service";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { UserProfileManagementRepository } from "@/store/users/user-profile-management.repository";
import BusinessLogService from "@/services/system/businesslog.service";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  ram = RamService.getInstance(),
  service = new UserService(),
  repo = UserProfileManagementRepository.getInstance();
let owner: string, actor: string, peer: string, foreign: string;
const action = "quyan:user:ChangeEmail",
  sendAction = "quyan:user:SendEmailChangeCode";
const principal = (): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user",
});
const identity = () => ({ principal: principal() });
const request = (auth = {}) =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user", ...auth },
    params: { userId: peer },
    query: { userId: peer, accountOwnerId: foreign },
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const arn = (id = actor) => `acs:quyan:*:${owner}:user/${id}`;
async function grant(Action = action, Resource = arn(), Effect: "Allow" | "Deny" = "Allow") {
  const policy = await ram.createPolicy(owner, {
    name: "email-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource } },
  });
  await ram.createAuthorization(owner, {
    principalType: "user",
    principalId: actor,
    policyId: policy.id,
    scopeType: "account",
  });
  return policy;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "profile-" + randomUUID(),
          password: "fixture-password-never-return",
          email: "fixture-" + randomUUID() + "@example.test",
          name: "original",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [Permission.USER_UPDATE_SELF_EMAIL],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
  await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
  vi.spyOn(EmailService.getInstance(), "sendVerificationCode").mockResolvedValue(undefined);
  vi.spyOn(EmailService.getInstance(), "verifyCode").mockResolvedValue(true);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
const data = () => ({ newEmail: "new-" + randomUUID() + "@example.test", verificationCode: "123456" });
describe("personal email resources and transactional authorization", () => {
  it("default denial does not send, consume a code or modify an email", async () => {
    const input = data(),
      before = (await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email;
    await expect(service.sendEmailChangeCode(actor, input.newEmail, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.changeEmail(actor, input, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(EmailService.getInstance().sendVerificationCode).not.toHaveBeenCalled();
    expect(EmailService.getInstance().verifyCode).not.toHaveBeenCalled();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).toBe(before);
  });
  it("treats send and change as independent native actions on one's own user", async () => {
    const input = data();
    await grant(sendAction);
    await service.sendEmailChangeCode(actor, input.newEmail, request());
    expect(EmailService.getInstance().sendVerificationCode).toHaveBeenCalledExactlyOnceWith(input.newEmail);
    await expect(service.changeEmail(actor, input, request())).rejects.toMatchObject({ statusCode: 403 });
    await grant();
    await service.changeEmail(actor, input, request());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).toBe(input.newEmail);
    expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledTimes(1);
  });
  it("explicit Deny and legacy removals override native Allow before code verification", async () => {
    await grant();
    await grant(action, arn(), "Deny");
    await expect(service.changeEmail(actor, data(), request())).rejects.toMatchObject({ statusCode: 403 });
    expect(EmailService.getInstance().verifyCode).not.toHaveBeenCalled();
  });
  it("projects legacy additions to both actions and removals back to Deny", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.USER_UPDATE_SELF_EMAIL] } });
    await service.sendEmailChangeCode(actor, data().newEmail, request());
    await service.changeEmail(actor, data(), request());
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.USER_UPDATE_SELF_EMAIL] },
    });
    await expect(service.sendEmailChangeCode(actor, data().newEmail, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("does not expand canonical JSON legacy actions to grant native email editing", async () => {
    await grant(actionForPermission(Permission.USER_UPDATE_SELF_EMAIL), "*");
    await expect(service.changeEmail(actor, data(), request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("wildcard grants cannot target peers, and request parameters cannot override identity", async () => {
    await grant(action, "*");
    await expect(service.changeEmail(peer, data(), request())).rejects.toMatchObject({ statusCode: 403 });
    const input = data();
    await service.changeEmail(actor, input, request());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).toBe(input.newEmail);
    expect(EmailService.getInstance().verifyCode).toHaveBeenCalledTimes(1);
  });
  it.each(["owner", "group", "policy", "authorization", "actor"] as const)(
    "rejects %s drift during verification without a write",
    async (kind) => {
      const policy = await grant(),
        input = data(),
        before = (await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email;
      let groupId: string | undefined;
      if (kind === "group") {
        groupId = (
          await prisma.group.create({
            data: { accountOwnerId: owner, username: "email-group-" + randomUUID(), permissions: [], level: 10 },
          })
        ).id;
        await prisma.user.update({ where: { id: actor }, data: { groupId } });
      }
      vi.mocked(EmailService.getInstance().verifyCode).mockImplementation(async () => {
        if (kind === "owner") await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
        if (kind === "group")
          await prisma.group.update({
            where: { id: groupId! },
            data: { permissions: [Permission.USER_UPDATE_SELF_EMAIL] },
          });
        if (kind === "policy") await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
        if (kind === "authorization")
          await prisma.ramAuthorization.updateMany({ where: { policyId: policy.id }, data: { status: 0 } });
        if (kind === "actor")
          await prisma.user.update({
            where: { id: actor },
            data: { name: "concurrent", updateTime: new Date(Date.now() + 1000) },
          });
        return true;
      });
      await expect(service.changeEmail(actor, input, request())).rejects.toMatchObject({
        statusCode: expect.any(Number),
      });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).toBe(before);
      expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
    },
  );
  it("does not dispatch mail after authorization changes during preflight validation", async () => {
    const policy = await grant(sendAction);
    const userRepo = await import("@/store/users/user.repository");
    vi.spyOn(userRepo.UserRepository.getInstance(), "findByEmailInNonDeleted").mockImplementation(async () => {
      await prisma.ramPolicy.update({ where: { id: policy.id }, data: { status: 0 } });
      return null;
    });
    await expect(service.sendEmailChangeCode(actor, data().newEmail, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(EmailService.getInstance().sendVerificationCode).not.toHaveBeenCalled();
  });
  it("checks newly occupied email addresses at the write boundary", async () => {
    await grant();
    const input = data();
    vi.mocked(EmailService.getInstance().verifyCode).mockImplementation(async () => {
      // A different account can occupy the email without changing this actor's authorization revision.
      await prisma.user.update({ where: { id: foreign }, data: { email: input.newEmail } });
      return true;
    });
    await expect(service.changeEmail(actor, input, request())).rejects.toMatchObject({ statusCode: 400 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).not.toBe(input.newEmail);
  });
  it("checks the daily business rule again after verification", async () => {
    await grant();
    const input = data();
    vi.mocked(EmailService.getInstance().verifyCode).mockImplementation(async () => {
      await prisma.businessLog.create({
        data: {
          operationType: OperationType.USER_EMAIL_CHANGE,
          operationCategory: OperationCategory.USER_MANAGEMENT,
          actorUserId: actor,
          description: "fixture",
          success: true,
          ipAddress: "192.0.2.1",
        },
      });
      return true;
    });
    await expect(service.changeEmail(actor, input, request())).rejects.toMatchObject({ statusCode: 400 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).not.toBe(input.newEmail);
  });
  it("allows only one writer for a shared revision", async () => {
    const auth = identity(),
      snapshot = await repo.emailSnapshot(auth);
    const outcomes = await Promise.allSettled([
      repo.updateEmail(auth, snapshot, data().newEmail, async () => {}),
      repo.updateEmail(auth, snapshot, data().newEmail, async () => {}),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });
  it.each(["scope", "token", "client"] as const)(
    "revalidates persisted OAuth email %s during the actual write",
    async (change) => {
      await grant();
      const client = await prisma.oAuthClient.create({
        data: {
          userId: owner,
          name: "fixture",
          clientId: "email-" + randomUUID(),
          reviewStatus: "approved",
          grantTypes: ["authorization_code"],
          redirectUris: ["https://example.test/callback"],
          scopes: ["email"],
        },
      });
      const token = await prisma.oAuthAccessToken.create({
        data: {
          userId: actor,
          oauthClientId: client.id,
          tokenHash: randomUUID(),
          scopes: ["email"],
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const req = request();
      req.oauthAccessToken = { id: token.id, userId: actor, oauthClientId: client.id, scopes: ["email"] } as never;
      const input = data();
      vi.mocked(EmailService.getInstance().verifyCode).mockImplementation(async () => {
        if (change === "scope")
          await prisma.oAuthAccessToken.update({ where: { id: token.id }, data: { scopes: ["profile"] } });
        if (change === "token")
          await prisma.oAuthAccessToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
        if (change === "client") await prisma.oAuthClient.update({ where: { id: client.id }, data: { status: 0 } });
        return true;
      });
      await expect(service.changeEmail(actor, input, req)).rejects.toMatchObject({ statusCode: 403 });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).not.toBe(input.newEmail);
    },
  );
  it("supports live email OAuth scope without granting access to peers", async () => {
    await grant();
    const client = await prisma.oAuthClient.create({
      data: {
        userId: owner,
        name: "fixture",
        clientId: "email-" + randomUUID(),
        reviewStatus: "approved",
        grantTypes: ["authorization_code"],
        redirectUris: ["https://example.test/callback"],
        scopes: ["email"],
      },
    });
    const token = await prisma.oAuthAccessToken.create({
      data: {
        userId: actor,
        oauthClientId: client.id,
        tokenHash: randomUUID(),
        scopes: ["email"],
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.oauthAccessToken = { id: token.id, userId: actor, oauthClientId: client.id, scopes: ["email"] } as never;
    const input = data();
    await service.changeEmail(actor, input, req);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).toBe(input.newEmail);
  });
  it("isolates role permissions and refuses revoked sessions", async () => {
    await grant();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "email-role-" + randomUUID() } }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "fixture",
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    const req = request({ subjectType: "assumed_role", assumedRoleId: role.id, roleSessionId: session.id });
    await expect(service.changeEmail(actor, data(), req)).rejects.toMatchObject({ statusCode: 403 });
    const policy = await ram.createPolicy(owner, {
      name: "role-email-" + randomUUID(),
      document: { Version: "1", Statement: { Effect: "Allow", Action: action, Resource: arn() } },
    });
    await ram.createAuthorization(owner, {
      principalType: "role",
      principalId: role.id,
      policyId: policy.id,
      scopeType: "account",
    });
    vi.mocked(EmailService.getInstance().verifyCode).mockImplementation(async () => {
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return true;
    });
    await expect(service.changeEmail(actor, data(), req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("retains old effective email permission and one write in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.USER_UPDATE_SELF_EMAIL] } });
    const input = data();
    await service.changeEmail(actor, input, request());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).toBe(input.newEmail);
    expect(EmailService.getInstance().verifyCode).toHaveBeenCalledTimes(1);
  });
  it("enforces AccessKey and read-only impersonation", async () => {
    await grant();
    const req = request({ subjectType: "access_key" }),
      input = data();
    await service.changeEmail(actor, input, req);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email).toBe(input.newEmail);
    req.user = { ...req.user!, impersonatorId: owner, impersonationMode: "view" };
    await expect(service.changeEmail(actor, data(), req)).rejects.toMatchObject({ statusCode: 403 });
  });
});
