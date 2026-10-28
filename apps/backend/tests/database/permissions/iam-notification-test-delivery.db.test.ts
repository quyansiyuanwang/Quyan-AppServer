import axios from "axios";
import nodemailer from "nodemailer";
import { ConfigService } from "@/services/system/config.service";
import { NotificationTestEmailRepository } from "@/store/notification/notification-test-email.repository";
import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ALL_NOTIFICATION_EVENTS, Permission, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { NotificationController } from "@/api/controllers/v1/notification/notification.controller";
import { NotificationManagementService } from "@/services/notification/notification-management.service";
import { NotificationWebhookManagementRepository } from "@/store/notification/notification-webhook-management.repository";
import { notificationWebhookArn } from "@/iam/resources/notification-resources";
import BusinessLogService from "@/services/system/businesslog.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const ram = RamService.getInstance(),
  controller = new NotificationController(),
  service = NotificationManagementService.getInstance();
const repository = NotificationWebhookManagementRepository.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
let sendMail: ReturnType<typeof vi.fn>;

const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}, userId = actor) =>
  new AsyncResource("notification-history-fixture").runInAsyncScope(async () => {
    const request = {
      user: { userId },
      params: {},
      query: { userId: peer, accountId: foreign },
      body: { userId: peer, accountOwnerId: foreign },
      headers: { "x-action": "quyan:notification:Manage", "x-account-id": foreign },
      secure: true,
      ip: "127.0.0.1",
      authContext: { principalUserId: userId, accountOwnerId: owner, subjectType: "sub_user", ...auth },
    } as unknown as TypedRequest;
    setRequestContext(request);
    return operation(request);
  });
async function grant(
  Action: string | string[],
  Resource = "*",
  Effect: "Allow" | "Deny" = "Allow",
  principalType: "user" | "group" | "role" = "user",
  principalId = actor,
  Condition?: IamCondition,
) {
  const policy = await ram.createPolicy(owner, {
    name: "notification-policy-" + randomUUID(),
    document: { Version: "1", Statement: { Effect, Action, Resource, ...(Condition && { Condition }) } },
  });
  await ram.createAuthorization(owner, { principalType, principalId, policyId: policy.id, scopeType: "account" });
}
const action = "quyan:notification:TestWebhook";
const createAction = "quyan:notification:TestEmail",
  updateAction = "quyan:notification:UpdateWebhook";
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "notification-user-" + randomUUID(),
          password: "fixture-only",
          email: "fixture-" + randomUUID() + "@example.invalid",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
  vi.spyOn(axios, "post").mockResolvedValue({ status: 200 });
  vi.spyOn(ConfigService.getInstance(), "getSmtpConfig").mockResolvedValue({
    host: "smtp.example.invalid",
    port: 465,
    secure: true,
    user: "fixture-only",
    password: "fixture-only",
    senderName: "Fixture",
    senderEmail: "sender@example.invalid",
  });
  vi.spyOn(ConfigService.getInstance(), "getSiteConfig").mockResolvedValue({
    backendPublicUrl: "https://example.invalid",
  } as never);
  sendMail = vi.fn().mockResolvedValue({});
  vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail } as never);
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});

const webhookArn = (id: string, userId = actor, accountId = owner) => notificationWebhookArn(accountId, userId, id);
const userArn = () => "acs:quyan:*:" + owner + ":user/" + actor;
const input = { name: "Webhook fixture", url: "https://example.invalid/webhook", format: "generic" as const };
async function webhook(userId = actor, data = {}) {
  const preference = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, subscribedEvents: [], knownEvents: ALL_NOTIFICATION_EVENTS, thresholds: {} },
    update: {},
  });
  return prisma.notificationWebhook.create({
    data: { userId, preferenceId: preference.id, ...input, secret: "fixture-only", ...data },
  });
}

const testWebhook = (id: string, auth = {}) =>
  run((request) => {
    request.params.id = id;
    return controller.testWebhook(id, request);
  }, auth);
const testEmail = () => run((request) => controller.testEmail(request));
describe("IAM test delivery side-effect boundary", () => {
  it("does not create preferences or deliver without specific TestEmail permission", async () => {
    await expect(testEmail()).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:notification:GetPreferences");
    await expect(testEmail()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.notificationPreference.findUnique({ where: { userId: actor } })).toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
    expect(await prisma.notificationInboxItem.count({ where: { userId: actor } })).toBe(0);
  });
  it("requires TestWebhook rather than CRUD permission before accessing credentials or sending", async () => {
    const own = await webhook();
    await grant(updateAction, webhookArn(own.id));
    const read = vi.spyOn(repository, "deliveryTarget");
    await expect(testWebhook(own.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });
  it("sends only the authorized concrete own Webhook using its stored signing credential", async () => {
    const own = await webhook(),
      other = await webhook();
    await grant(action, webhookArn(own.id));
    expect(await testWebhook(own.id)).toEqual({ success: true });
    expect(axios.post).toHaveBeenCalledWith(
      own.url,
      expect.objectContaining({ event: "balance_low" }),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Webhook-Signature": expect.stringMatching(/^sha256=[a-f0-9]{64}$/) }),
      }),
    );
    expect(axios.post).toHaveBeenCalledTimes(1);
    await expect(testWebhook(other.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
  it("authorizes actual service arguments without trusting route identity or Action headers", async () => {
    const own = await webhook(),
      other = await webhook();
    await grant(action, webhookArn(own.id));
    expect(
      await run((request) => {
        request.params.id = other.id;
        return service.testWebhook(own.id, actor, request);
      }),
    ).toEqual({ success: true });
    await expect(
      run((request) => {
        request.params.id = own.id;
        return service.testWebhook(other.id, actor, request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
  it("does not send foreign, inactive, case-aliased or broken-parent targets", async () => {
    const own = await webhook(),
      other = await webhook(peer);
    await grant(action);
    for (const id of [other.id, own.id.toUpperCase(), "missing"])
      await expect(testWebhook(id)).rejects.toMatchObject({ statusCode: 404 });
    await prisma.notificationPreference.update({ where: { id: own.preferenceId }, data: { status: 0 } });
    await expect(testWebhook(own.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(axios.post).not.toHaveBeenCalled();
  });
  it("applies explicit TestWebhook Deny even with historic management Allow", async () => {
    const own = await webhook();
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.NOTIFICATION_MANAGE] } });
    await grant(action, webhookArn(own.id), "Deny");
    await expect(testWebhook(own.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.post).not.toHaveBeenCalled();
  });
  it("sends test email to the executing user's current stored preference and creates an own inbox item", async () => {
    await grant(createAction, userArn());
    expect(await testEmail()).toEqual({ success: true });
    const actorUser = await prisma.user.findUniqueOrThrow({ where: { id: actor } });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: actorUser.email, html: expect.any(String) }));
    expect(await prisma.notificationInboxItem.count({ where: { userId: actor } })).toBe(1);
    expect(await prisma.notificationInboxItem.count({ where: { userId: peer } })).toBe(0);
  });
  it("does not send or create an inbox item when configured email has been cleared", async () => {
    const own = await webhook();
    await prisma.notificationPreference.update({ where: { id: own.preferenceId }, data: { notificationEmail: null } });
    await grant(createAction, userArn());
    expect(await testEmail()).toMatchObject({ success: false, error: expect.any(String) });
    expect(sendMail).not.toHaveBeenCalled();
    expect(await prisma.notificationInboxItem.count({ where: { userId: actor } })).toBe(0);
  });
  it("honors TestEmail Deny without preference initialization", async () => {
    await grant(createAction);
    await grant(createAction, userArn(), "Deny");
    await expect(testEmail()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.notificationPreference.findUnique({ where: { userId: actor } })).toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
  });
  it.each(["webhook", "preference", "identity"])(
    "rejects %s changes immediately before Webhook network delivery",
    async (target) => {
      const own = await webhook();
      await grant(action);
      const original = repository.deliveryTarget.bind(repository);
      vi.spyOn(repository, "deliveryTarget").mockImplementationOnce(async (principal, expected) => {
        if (target === "webhook")
          await prisma.notificationWebhook.update({
            where: { id: own.id },
            data: { updateTime: new Date(Date.now() + 10000) },
          });
        else if (target === "preference")
          await prisma.notificationPreference.update({ where: { id: own.preferenceId }, data: { status: 0 } });
        else await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
        return original(principal, expected);
      });
      await expect(testWebhook(own.id)).rejects.toMatchObject({
        statusCode: target === "webhook" ? 409 : target === "preference" ? 404 : 403,
      });
      expect(axios.post).not.toHaveBeenCalled();
    },
  );
  it.each(["email", "identity"])(
    "rechecks %s after loading SMTP configuration and before inbox/network side effects",
    async (target) => {
      const own = await webhook();
      await prisma.notificationPreference.update({
        where: { id: own.preferenceId },
        data: { notificationEmail: "own@example.invalid" },
      });
      await grant(createAction);
      const original = NotificationTestEmailRepository.getInstance().prepare.bind(
        NotificationTestEmailRepository.getInstance(),
      );
      vi.spyOn(NotificationTestEmailRepository.getInstance(), "prepare").mockImplementationOnce(
        async (principal, expected, document) => {
          if (target === "email")
            await prisma.notificationPreference.update({
              where: { id: own.preferenceId },
              data: { notificationEmail: "changed@example.invalid", updateTime: new Date(Date.now() + 10000) },
            });
          else await prisma.user.update({ where: { id: actor }, data: { accountOwnerId: foreign } });
          return original(principal, expected, document);
        },
      );
      await expect(testEmail()).rejects.toMatchObject({ statusCode: target === "email" ? 409 : 403 });
      expect(sendMail).not.toHaveBeenCalled();
      expect(await prisma.notificationInboxItem.count({ where: { userId: actor } })).toBe(0);
    },
  );
  it("uses role grants and rejects revoked sessions at final Webhook delivery", async () => {
    const own = await webhook();
    await grant(action);
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "test-delivery-role-" + randomUUID() },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "test",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(testWebhook(own.id, auth)).rejects.toMatchObject({ statusCode: 403 });
    await grant(action, webhookArn(own.id), "Allow", "role", role.id);
    const original = repository.deliveryTarget.bind(repository);
    vi.spyOn(repository, "deliveryTarget").mockImplementationOnce(async (principal, expected) => {
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return original(principal, expected);
    });
    await expect(testWebhook(own.id, auth)).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.post).not.toHaveBeenCalled();
  });
  it("sanitizes upstream credential/URL/response text and localizes safe delivery errors", async () => {
    const own = await webhook();
    await grant([action, createAction]);
    vi.mocked(axios.post).mockRejectedValue(new Error("fixture-only-secret https://internal.invalid token=fixture"));
    const result = await run((request) => {
      request.params.id = own.id;
      request.locale = "zh-CN";
      return controller.testWebhook(own.id, request);
    });
    expect(result).toEqual({ success: false, error: "测试投递失败，请检查目标地址和投递配置。" });
    sendMail.mockRejectedValue(new Error("smtp-password fixture-only"));
    await prisma.notificationPreference.update({
      where: { id: own.preferenceId },
      data: { notificationEmail: "own@example.invalid" },
    });
    expect(await testEmail()).toEqual({
      success: false,
      error: "Test delivery failed. Check the destination and delivery configuration.",
    });
  });
  it("supports resource-group Deny for test targets as membership changes", async () => {
    const own = await webhook();
    await grant(action);
    const group = await ram.createResourceGroup(owner, { name: "test-delivery-group-" + randomUUID() });
    const policy = await ram.createPolicy(owner, {
      name: "test-delivery-deny-" + randomUUID(),
      document: { Version: "1", Statement: { Effect: "Deny", Action: action, Resource: "*" } },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    await ram.addResourceGroupMember(owner, group.id, { resourceArn: webhookArn(own.id) });
    await expect(testWebhook(own.id)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramResourceGroupMember.updateMany({ where: { resourceGroupId: group.id }, data: { status: 0 } });
    expect(await testWebhook(own.id)).toEqual({ success: true });
  });
  it.each(["legacy", "shadow"] as const)("retains historic management requirements in %s mode", async (mode) => {
    const own = await webhook();
    await grant(action);
    env.security.iamAuthorizationMode = mode;
    await expect(testWebhook(own.id)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.NOTIFICATION_MANAGE] } });
    expect(await testWebhook(own.id)).toEqual({ success: true });
  });
});
