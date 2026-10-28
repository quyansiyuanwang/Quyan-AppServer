import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ALL_NOTIFICATION_EVENTS, Permission, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { NotificationController } from "@/api/controllers/v1/notification/notification.controller";
import { NotificationManagementService } from "@/services/notification/notification-management.service";
import { NotificationPreferenceInitializerService } from "@/services/notification/notification-preference-initializer.service";
import { NotificationPreferenceManagementRepository } from "@/store/notification/notification-preference-management.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const ram = RamService.getInstance(),
  controller = new NotificationController(),
  service = NotificationManagementService.getInstance();
const repository = NotificationPreferenceManagementRepository.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;
const arn = (userId = actor, accountId = owner) => "acs:quyan:*:" + accountId + ":user/" + userId;
const preference = () => prisma.notificationPreference.findUnique({ where: { userId: actor } });
const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}, userId = actor) =>
  new AsyncResource("notification-preferences-fixture").runInAsyncScope(async () => {
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
  Resource = arn(),
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
const actions = ["quyan:notification:GetPreferences", "quyan:notification:UpdatePreferences"];
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

describe("IAM notification preferences on the actual executing user", () => {
  it("authorizes a native read and initializes the executing user's preferences without accepting client targets", async () => {
    await grant(actions[0]);
    const result = await run(async (request) => {
      const dto = await controller.getPreferences(request);
      expect(request.iamDecisions?.length).toBeGreaterThan(0);
      expect(request.iamDecisions?.every((d) => d.action === actions[0] && d.resource === arn())).toBe(true);
      return dto;
    });
    expect(result.notificationEmail).toBe((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).email);
    expect(await preference()).toMatchObject({ id: result.id, userId: actor, status: 1 });
    expect(await prisma.notificationPreference.findUnique({ where: { userId: peer } })).toBeNull();
    expect(result).not.toHaveProperty("userId");
    await expect(
      run((request) => controller.updatePreferences({ cooldownMinutes: 30 }, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not initialize or update without an Allow or from a canonical JSON Manage grant", async () => {
    await expect(run((request) => service.getPreference(actor, request))).rejects.toMatchObject({ statusCode: 403 });
    await grant("quyan:notification:Manage", "*");
    await expect(run((request) => controller.getPreferences(request))).rejects.toMatchObject({ statusCode: 403 });
    await expect(run((request) => controller.updatePreferences({}, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await preference()).toBeNull();
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("denies peer/foreign user and account-only resources instead of falling back to account scope", async () => {
    await grant(actions, arn(peer));
    await expect(grant(actions, "acs:quyan:*:" + owner + ":account")).rejects.toMatchObject({ statusCode: 400 });
    await expect(run((request) => controller.getPreferences(request))).rejects.toMatchObject({ statusCode: 403 });
    await expect(run((request) => service.updatePreference(actor, {}, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(run((request) => service.getPreference(peer, request))).rejects.toMatchObject({ statusCode: 403 });
    await expect(run((request) => service.getPreference(foreign, request))).rejects.toMatchObject({ statusCode: 403 });
    expect(await preference()).toBeNull();
  });
  it("persists a whitelisted update without a read grant, keeping explicitly empty subscriptions", async () => {
    await grant(actions[1]);
    const result = await run((request) =>
      controller.updatePreferences(
        {
          notificationEmail: null,
          subscribedEvents: [],
          cooldownMinutes: 0,
          thresholds: {},
          userId: peer,
          accountOwnerId: foreign,
          id: "forged",
          status: -1,
          knownEvents: ["forged"],
        } as any,
        request,
      ),
    );
    expect(result).toMatchObject({ notificationEmail: null, subscribedEvents: [], cooldownMinutes: 0, thresholds: {} });
    expect(await preference()).toMatchObject({ userId: actor, status: 1, knownEvents: [...ALL_NOTIFICATION_EVENTS] });
    expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: actor, targetResourceId: result.id, success: true }),
    );
    await expect(run((request) => controller.getPreferences(request))).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["get", "update"] as const)("lets actual-resource Deny override a broad Allow for %s", async (operation) => {
    await grant(actions, "*");
    await grant(actions, arn(), "Deny");
    await expect(
      run((request) =>
        operation === "get" ? controller.getPreferences(request) : controller.updatePreferences({}, request),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await preference()).toBeNull();
  });
  it("evaluates trusted transport Conditions, not condition fields or headers in the request", async () => {
    await grant(actions, arn(), "Allow", "user", actor, { Bool: { "acs:SecureTransport": true } });
    await expect(
      run((request) => {
        Object.defineProperty(request, "secure", { value: false });
        request.headers["x-secure-transport"] = "true";
        return service.getPreference(actor, request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await preference()).toBeNull();
    expect((await run((request) => controller.getPreferences(request))).id).toBeDefined();
  });
  it("merges group grants and user Deny on native Actions", async () => {
    const group = await prisma.group.create({
      data: {
        username: "notification-group-" + randomUUID(),
        name: "Notification fixture group",
        accountOwnerId: owner,
        permissions: [],
      },
    });
    await prisma.user.update({ where: { id: actor }, data: { groupId: group.id } });
    await grant(actions, arn(), "Allow", "group", group.id);
    expect(
      (await run((request) => service.updatePreference(actor, { cooldownMinutes: 30 }, request))).cooldownMinutes,
    ).toBe(30);
    await grant(actions[1], arn(), "Deny");
    await expect(
      run((request) => service.updatePreference(actor, { cooldownMinutes: 40 }, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await preference())?.cooldownMinutes).toBe(30);
  });
  it("supports legacy grants/removals and AccessKey requests without a default self-service grant", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.NOTIFICATION_MANAGE] } });
    expect(
      (await run((request) => controller.getPreferences(request), { subjectType: "access_key" })).id,
    ).toBeDefined();
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.NOTIFICATION_MANAGE] } });
    await expect(
      run((request) => controller.updatePreferences({ cooldownMinutes: 20 }, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await preference())?.cooldownMinutes).toBe(60);
  });
  it("uses role policies instead of the subject's own grants, and refuses expired sessions", async () => {
    await grant(actions);
    const role = await prisma.ramRole.create({
      data: { name: "notification-role-" + randomUUID(), accountOwnerId: owner },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    await expect(run((request) => controller.getPreferences(request), auth)).rejects.toMatchObject({ statusCode: 403 });
    await grant(actions, arn(), "Allow", "role", role.id);
    expect((await run((request) => controller.getPreferences(request), auth)).id).toBeDefined();
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(
      run((request) => service.updatePreference(actor, { cooldownMinutes: 15 }, request), auth),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks role revocation between the decision and persistence", async () => {
    const role = await prisma.ramRole.create({
      data: { name: "notification-role-" + randomUUID(), accountOwnerId: owner },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await grant(actions, arn(), "Allow", "role", role.id);
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorize.bind(iam);
    vi.spyOn(iam, "authorize").mockImplementationOnce(async (input) => {
      const result = await original(input);
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return result;
    });
    await expect(
      run((request) => service.updatePreference(actor, {}, request), {
        roleSessionId: session.id,
        assumedRoleId: role.id,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await preference()).toBeNull();
  });
  it.each(["actor-disabled", "owner-disabled", "reparented"] as const)(
    "rechecks %s after authorization before any preference write",
    async (scenario) => {
      await grant(actions);
      const iam = IamAuthorizationService.getInstance(),
        original = iam.authorize.bind(iam);
      vi.spyOn(iam, "authorize").mockImplementationOnce(async (input) => {
        const result = await original(input);
        await prisma.user.update({
          where: { id: scenario === "owner-disabled" ? owner : actor },
          data: scenario === "reparented" ? { accountOwnerId: foreign } : { status: 0 },
        });
        return result;
      });
      await expect(run((request) => service.updatePreference(actor, {}, request))).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(await preference()).toBeNull();
    },
  );
  it.each([0, -1])("does not revive an inactive preference (status %s)", async (status) => {
    await grant(actions);
    const row = await prisma.notificationPreference.create({ data: { userId: actor, status } });
    await expect(run((request) => service.getPreference(actor, request))).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run((request) => service.updatePreference(actor, { cooldownMinutes: 20 }, request)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await preference()).toMatchObject({ id: row.id, status, cooldownMinutes: 60 });
  });
  it("rejects missing identity, mismatched principal and SQL case aliases", async () => {
    await grant(actions);
    await expect(service.getPreference(actor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run((request) => {
        delete request.authContext;
        return service.getPreference(actor, request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run((request) => service.getPreference(actor, request), { principalUserId: peer }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run((request) => service.getPreference(actor.toUpperCase(), request), {}, actor.toUpperCase()),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      run((request) => service.getPreference(actor, request), { accountOwnerId: owner.toUpperCase() }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await preference()).toBeNull();
  });
  it("rejects invalid internal data before persistence or audit", async () => {
    await grant(actions);
    await expect(
      run((request) => service.updatePreference(actor, { cooldownMinutes: -1 }, request)),
    ).rejects.toMatchObject({ statusCode: 400, messageKey: "errors.validationFailed", data: undefined });
    expect(await preference()).toBeNull();
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("keeps removed subscriptions off and synchronizes only newly introduced known events", async () => {
    await grant(actions[0]);
    const newest = ALL_NOTIFICATION_EVENTS.at(-1)!;
    await prisma.notificationPreference.create({
      data: { userId: actor, subscribedEvents: [], knownEvents: ALL_NOTIFICATION_EVENTS.slice(0, -1) },
    });
    expect((await run((request) => controller.getPreferences(request))).subscribedEvents).toEqual([newest]);
    await prisma.notificationPreference.update({ where: { userId: actor }, data: { subscribedEvents: [] } });
    expect((await run((request) => controller.getPreferences(request))).subscribedEvents).toEqual([]);
    await prisma.notificationPreference.update({ where: { userId: actor }, data: { knownEvents: [] } });
    expect((await run((request) => controller.getPreferences(request))).subscribedEvents).toEqual([]);
    expect((await preference())?.knownEvents).toEqual([...ALL_NOTIFICATION_EVENTS]);
  });
  it("derives event synchronization from the latest record rather than a stale pre-read", async () => {
    await grant(actions[0]);
    await prisma.notificationPreference.create({
      data: {
        userId: actor,
        subscribedEvents: [ALL_NOTIFICATION_EVENTS[0]],
        knownEvents: ALL_NOTIFICATION_EVENTS.slice(0, -1),
      },
    });
    const original = repository.find.bind(repository);
    vi.spyOn(repository, "find").mockImplementationOnce(async (principal) => {
      const snapshot = await original(principal);
      await prisma.notificationPreference.update({
        where: { userId: actor },
        data: { subscribedEvents: [], knownEvents: [...ALL_NOTIFICATION_EVENTS] },
      });
      return snapshot;
    });
    expect((await run((request) => service.getPreference(actor, request))).subscribedEvents).toEqual([]);
    expect((await preference())?.subscribedEvents).toEqual([]);
  });
  it("does not overwrite a preference created concurrently with default initialization", async () => {
    await grant(actions[0]);
    const original = repository.find.bind(repository);
    vi.spyOn(repository, "find").mockImplementationOnce(async (principal) => {
      const missing = await original(principal);
      await prisma.notificationPreference.create({
        data: { userId: actor, subscribedEvents: [], knownEvents: [...ALL_NOTIFICATION_EVENTS], cooldownMinutes: 7 },
      });
      return missing;
    });
    expect((await run((request) => service.getPreference(actor, request))).cooldownMinutes).toBe(7);
    expect((await preference())?.subscribedEvents).toEqual([]);
  });
  it.each(["P2002", "P2034"])("localizes transaction conflicts (%s), without a success log", async (code) => {
    await grant(actions[1]);
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("fixture conflict", {
        code,
        clientVersion: Prisma.prismaVersion.client,
      }),
    );
    await expect(run((request) => service.updatePreference(actor, {}, request))).rejects.toMatchObject({
      statusCode: 409,
      messageKey: "errors.conflict",
      data: undefined,
    });
    expect(await preference()).toBeNull();
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("fails closed when policy loading fails, without initialization", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "authorize").mockRejectedValueOnce(
      new Error("fixture store unavailable"),
    );
    await expect(run((request) => service.getPreference(actor, request))).rejects.toThrow("fixture store unavailable");
    expect(await preference()).toBeNull();
  });
  it.each(["legacy", "shadow"] as const)("retains old permission enforcement in %s mode", async (mode) => {
    await grant(actions, "*", "Deny");
    env.security.iamAuthorizationMode = mode;
    await expect(run((request) => controller.getPreferences(request))).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.NOTIFICATION_MANAGE] } });
    const result = await run((request) => controller.updatePreferences({ cooldownMinutes: 15 }, request));
    expect(result.cooldownMinutes).toBe(15);
    expect((await run((request) => controller.getPreferences(request))).id).toBe(result.id);
  });
  it("retains the explicitly separate background initializer without request IAM context", async () => {
    const result = await NotificationPreferenceInitializerService.getInstance().getOrInitialize(actor);
    expect(result.userId).toBe(actor);
    expect(result.knownEvents).toEqual([...ALL_NOTIFICATION_EVENTS]);
    await expect(run((request) => controller.getPreferences(request))).rejects.toMatchObject({ statusCode: 403 });
  });
});
