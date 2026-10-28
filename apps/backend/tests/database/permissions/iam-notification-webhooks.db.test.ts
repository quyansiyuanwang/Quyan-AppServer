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
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const ram = RamService.getInstance(),
  controller = new NotificationController(),
  service = NotificationManagementService.getInstance();
const repository = NotificationWebhookManagementRepository.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;

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
const action = "quyan:notification:ListWebhooks";
const createAction = "quyan:notification:CreateWebhook",
  updateAction = "quyan:notification:UpdateWebhook",
  deleteAction = "quyan:notification:DeleteWebhook";
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
const list = () => run((request) => controller.listWebhooks(request));
const update = (id: string, body = { name: "Updated" }) =>
  run((request) => {
    request.params.id = id;
    return controller.updateWebhook(id, body, request);
  });
const remove = (id: string) =>
  run((request) => {
    request.params.id = id;
    return controller.deleteWebhook(id, request);
  });
const create = (body = input) => run((request) => controller.createWebhook(body, request));
describe("resource-level Webhook management", () => {
  it("has no implicit self grant and does not widen canonical JSON Manage", async () => {
    await webhook();
    expect(await list()).toEqual([]);
    await grant("quyan:notification:Manage");
    expect(await list()).toEqual([]);
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.notificationWebhook.count({ where: { userId: actor } })).toBe(1);
  });
  it("lists only individually granted own Webhooks and strips secrets", async () => {
    const own = await webhook();
    await webhook();
    await webhook(peer);
    await webhook(foreign);
    await grant(action, webhookArn(own.id));
    const result = await list();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: own.id, hasSecret: true });
    expect(result[0]).not.toHaveProperty("secret");
    expect(result[0]).not.toHaveProperty("userId");
  });
  it("applies resource Deny and legacy management removals", async () => {
    const own = await webhook(),
      denied = await webhook();
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.NOTIFICATION_MANAGE] } });
    await grant(action, webhookArn(denied.id), "Deny");
    expect((await list()).map((row) => row.id)).toEqual([own.id]);
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.NOTIFICATION_MANAGE] } });
    expect(await list()).toEqual([]);
    await expect(update(own.id)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires CreateWebhook on the executing user before any preference initialization", async () => {
    await grant(updateAction);
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.notificationPreference.findUnique({ where: { userId: actor } })).toBeNull();
    await grant(createAction, userArn());
    const result = await create({
      ...input,
      userId: peer,
      preferenceId: "foreign",
      accountOwnerId: foreign,
      status: -1,
    } as typeof input);
    expect(result.hasSecret).toBe(false);
    const row = await prisma.notificationWebhook.findUniqueOrThrow({
      where: { id: result.id },
      include: { preference: true },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor } });
    expect(row).toMatchObject({
      userId: actor,
      status: 1,
      preference: { userId: actor, notificationEmail: user.email },
    });
    expect(result).not.toHaveProperty("secret");
  });
  it("preserves existing preferences rather than silently changing subscriptions during create", async () => {
    const existing = await webhook();
    await prisma.notificationPreference.update({
      where: { id: existing.preferenceId },
      data: { subscribedEvents: [], knownEvents: [], cooldownMinutes: 7 },
    });
    await grant(createAction, userArn());
    await create();
    expect(
      await prisma.notificationPreference.findUniqueOrThrow({ where: { id: existing.preferenceId } }),
    ).toMatchObject({ subscribedEvents: [], knownEvents: [], cooldownMinutes: 7 });
  });
  it("rolls back preference initialization when Webhook creation fails", async () => {
    const { NotificationPreferenceInitializerService } = await import(
      "@/services/notification/notification-preference-initializer.service"
    );
    const defaults = await NotificationPreferenceInitializerService.getInstance().getInitializationDefaults();
    await expect(
      run(async (request) => {
        const { getIamPrincipal } = await import("@/iam/request/principal-context");
        return repository.create(getIamPrincipal(request)!, { ...input, name: "x".repeat(200) }, defaults);
      }),
    ).rejects.toThrow();
    expect(await prisma.notificationPreference.findUnique({ where: { userId: actor } })).toBeNull();
  });
  it("authorizes actual method arguments rather than forged path or Action headers", async () => {
    const one = await webhook(),
      two = await webhook();
    await grant(updateAction, webhookArn(one.id));
    await run((request) => {
      request.params.id = two.id;
      return service.updateWebhook(one.id, actor, { name: "Allowed" }, request);
    });
    await expect(
      run((request) => {
        request.params.id = one.id;
        return service.updateWebhook(two.id, actor, { name: "Denied" }, request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: two.id } })).name).toBe(input.name);
  });
  it("separates update/delete grants and honors Deny without success audit", async () => {
    const own = await webhook();
    await grant([updateAction, deleteAction], webhookArn(own.id));
    const changed = await run((request) =>
      service.updateWebhook(
        own.id,
        actor,
        { secret: null, enabled: false, userId: peer, preferenceId: "foreign", status: -1 } as never,
        request,
      ),
    );
    expect(changed).toMatchObject({ hasSecret: false, enabled: false });
    expect(await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({
      userId: actor,
      preferenceId: own.preferenceId,
      status: 1,
      secret: null,
    });
    await grant(deleteAction, webhookArn(own.id), "Deny");
    vi.mocked(BusinessLogService.getInstance().logOperation).mockClear();
    await expect(remove(own.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
    expect((await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(1);
  });
  it("soft-deletes only an allowed own Webhook", async () => {
    const own = await webhook(),
      other = await webhook(peer);
    await grant(deleteAction);
    expect(await remove(own.id)).toEqual({ success: true });
    expect((await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(0);
    await expect(remove(other.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(1);
  });
  it("rejects peer/foreign, case-aliased, missing, and noncanonical targets", async () => {
    const own = await webhook(),
      other = await webhook(peer),
      remote = await webhook(foreign);
    await grant([updateAction, deleteAction]);
    for (const id of [other.id, remote.id, own.id.toUpperCase(), "missing"])
      await expect(update(id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(update("target/*")).rejects.toMatchObject({ statusCode: 403 });
    await expect(run((request) => service.updateWebhook(own.id, peer, {}, request))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects inactive or foreign parent preferences on read and mutation", async () => {
    const own = await webhook(),
      other = await webhook(peer);
    await grant([action, updateAction, createAction]);
    await prisma.notificationWebhook.update({ where: { id: own.id }, data: { preferenceId: other.preferenceId } });
    expect(await list()).toEqual([]);
    await expect(update(own.id)).rejects.toMatchObject({ statusCode: 404 });
    await prisma.notificationWebhook.update({ where: { id: own.id }, data: { preferenceId: own.preferenceId } });
    await prisma.notificationPreference.update({ where: { id: own.preferenceId }, data: { status: 0 } });
    expect(await list()).toEqual([]);
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["webhook", "preference"])("detects %s snapshot changes before mutation", async (target) => {
    const own = await webhook();
    await grant(updateAction);
    const original = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementationOnce(async (principal, expected, data) => {
      if (target === "webhook")
        await prisma.notificationWebhook.update({
          where: { id: own.id },
          data: { updateTime: new Date(Date.now() + 10000) },
        });
      else
        await prisma.notificationPreference.update({
          where: { id: own.preferenceId },
          data: { updateTime: new Date(Date.now() + 10000) },
        });
      return original(principal, expected, data);
    });
    await expect(update(own.id)).rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: own.id } })).name).toBe(input.name);
  });
  it.each(["actor", "owner", "account"])("rechecks live %s inside the final write", async (target) => {
    const own = await webhook();
    await grant(updateAction);
    const original = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementationOnce(async (principal, expected, data) => {
      if (target === "account") await prisma.user.update({ where: { id: actor }, data: { accountOwnerId: foreign } });
      else await prisma.user.update({ where: { id: target === "actor" ? actor : owner }, data: { status: 0 } });
      return original(principal, expected, data);
    });
    await expect(update(own.id)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.notificationWebhook.findUniqueOrThrow({ where: { id: own.id } })).name).toBe(input.name);
  });
  it("uses role policies and rejects revoked sessions before mutation", async () => {
    const own = await webhook();
    await grant(updateAction);
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "webhook-role-" + randomUUID() } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "webhook",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(
      run((request) => service.updateWebhook(own.id, actor, { name: "Denied" }, request), auth),
    ).rejects.toMatchObject({ statusCode: 403 });
    await grant(updateAction, webhookArn(own.id), "Allow", "role", role.id);
    const original = repository.update.bind(repository);
    vi.spyOn(repository, "update").mockImplementationOnce(async (principal, expected, data) => {
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return original(principal, expected, data);
    });
    await expect(
      run((request) => service.updateWebhook(own.id, actor, { name: "Denied" }, request), auth),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks selected list grants before reading content", async () => {
    const own = await webhook();
    await grant(action);
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementationOnce(async (input) => {
      const result = await original(input);
      await grant(action, webhookArn(own.id), "Deny");
      return result;
    });
    const hydrate = vi.spyOn(repository, "hydrate");
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("rejects missing identity, disabled owner and unavailable policy stores even on empty lists", async () => {
    await expect(service.listWebhooks(actor)).rejects.toMatchObject({ statusCode: 403 });
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValueOnce(
      new Error("fixture store unavailable"),
    );
    await expect(list()).rejects.toThrow("fixture store unavailable");
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies resource group scope dynamically and validates real ownership", async () => {
    const own = await webhook();
    await grant(action);
    const group = await ram.createResourceGroup(owner, { name: "webhook-group-" + randomUUID() });
    const policy = await ram.createPolicy(owner, {
      name: "webhook-deny-" + randomUUID(),
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
    expect(await list()).toEqual([]);
    await prisma.ramResourceGroupMember.updateMany({ where: { resourceGroupId: group.id }, data: { status: 0 } });
    expect((await list()).map((row) => row.id)).toEqual([own.id]);
    const groups = RamResourceGroupRepository.getInstance();
    for (const arn of [webhookArn(own.id, peer), webhookArn(own.id.toUpperCase()), webhookArn(own.id, actor, foreign)])
      expect(await groups.resourceExistsInAccount(arn, owner)).toBe(false);
  });
  it("checks live transport Conditions instead of forged client flags", async () => {
    const own = await webhook();
    await grant(updateAction, webhookArn(own.id), "Allow", "user", actor, { Bool: { "acs:SecureTransport": true } });
    await update(own.id);
    await expect(
      run((request) => {
        Object.defineProperty(request, "secure", { value: false });
        request.headers["x-secure-transport"] = "true";
        return service.updateWebhook(own.id, actor, {}, request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("keeps historic NOTIFICATION_MANAGE enforcement in %s", async (mode) => {
    const own = await webhook();
    await grant(action, webhookArn(own.id));
    env.security.iamAuthorizationMode = mode;
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.NOTIFICATION_MANAGE] } });
    expect((await list()).map((row) => row.id)).toEqual([own.id]);
  });
  it("scans beyond a bounded page and authorizes every selected Webhook", async () => {
    const own = await webhook();
    await prisma.notificationWebhook.createMany({
      data: Array.from({ length: 504 }, (_, index) => ({
        ...input,
        userId: actor,
        preferenceId: own.preferenceId,
        name: "Hook " + index,
      })),
    });
    await grant(action);
    const scan = vi.spyOn(repository, "scan");
    const result = await list();
    expect(result).toHaveLength(505);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(new Set(result.map((row) => row.id)).size).toBe(505);
    expect(result.every((row) => !("secret" in row))).toBe(true);
  });
  it("supports AccessKey subjects and group-scoped explicit Deny", async () => {
    const own = await webhook();
    await grant(action);
    const group = await prisma.group.create({
      data: {
        username: "webhook-group-" + randomUUID(),
        name: "Webhook fixture group",
        accountOwnerId: owner,
        permissions: [],
      },
    });
    await prisma.user.update({ where: { id: actor }, data: { groupId: group.id } });
    expect(
      (await run((request) => controller.listWebhooks(request), { subjectType: "access_key" })).map((row) => row.id),
    ).toEqual([own.id]);
    await grant(action, webhookArn(own.id), "Deny", "group", group.id);
    expect(await run((request) => controller.listWebhooks(request), { subjectType: "access_key" })).toEqual([]);
  });
  it("rechecks the preference snapshot before list content hydration", async () => {
    const own = await webhook();
    await grant(action);
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementationOnce(async (principal, rows) => {
      await prisma.notificationPreference.update({
        where: { id: own.preferenceId },
        data: { updateTime: new Date(Date.now() + 10000) },
      });
      return original(principal, rows);
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 409 });
  });
});
