import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ALL_NOTIFICATION_EVENTS, Permission, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { NotificationController } from "@/api/controllers/v1/notification/notification.controller";
import { NotificationManagementService } from "@/services/notification/notification-management.service";
import { NotificationHistoryManagementRepository } from "@/store/notification/notification-history-management.repository";
import { notificationDeliveryLogArn } from "@/iam/resources/notification-resources";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const ram = RamService.getInstance(),
  controller = new NotificationController(),
  service = NotificationManagementService.getInstance();
const repository = NotificationHistoryManagementRepository.getInstance();
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
const action = "quyan:notification:ListDeliveryLogs";
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

const logArn = (logId: string, userId = actor, accountId = owner) =>
  notificationDeliveryLogArn(accountId, userId, logId);
async function delivery(userId = actor, data = {}) {
  return prisma.notificationLog.create({
    data: {
      userId,
      eventType: ALL_NOTIFICATION_EVENTS[0],
      title: "History fixture",
      content: "Fixture log content",
      channel: "email",
      deliveryStatus: "sent",
      ...data,
    },
  });
}
const list = (page = 1, pageSize = 20) => run((request) => controller.getLogs(page, pageSize, request));
describe("resource-level notification delivery history and event catalog", () => {
  it("returns no logs without Allow and does not reinterpret a canonical JSON Manage grant", async () => {
    await delivery();
    expect(await list()).toMatchObject({ logs: [], total: 0 });
    await grant("quyan:notification:Manage");
    expect((await list()).total).toBe(0);
  });
  it("honors native resource grants and fixed actions without accepting client identity overrides", async () => {
    const one = await delivery(),
      two = await delivery();
    await delivery(peer);
    await delivery(foreign);
    await grant(action, logArn(one.id));
    const result = await run(async (request) => {
      const result = await controller.getLogs(1, 20, request);
      expect(request.iamDecisions?.every((result) => result.action === action)).toBe(true);
      return result;
    });
    expect(result).toMatchObject({ total: 1, logs: [{ id: one.id }] });
    expect(result.logs[0]).not.toHaveProperty("userId");
    expect(result.logs[0]).not.toHaveProperty("metadata");
    expect(result.logs.some((log) => log.id === two.id)).toBe(false);
  });
  it("applies Deny before pagination and total calculation", async () => {
    const hidden = await delivery(actor, { createTime: new Date(2026, 0, 3) });
    const one = await delivery(actor, { createTime: new Date(2026, 0, 2) }),
      two = await delivery(actor, { createTime: new Date(2026, 0, 1) });
    await grant(action, "*");
    await grant(action, logArn(hidden.id), "Deny");
    expect(await list(1, 1)).toMatchObject({ total: 2, logs: [{ id: one.id }] });
    expect(await list(2, 1)).toMatchObject({ total: 2, logs: [{ id: two.id }] });
    expect(await list(3, 1)).toMatchObject({ total: 2, logs: [] });
  });
  it("converts old management grants/removals and supports AccessKey subjects without default sensitive access", async () => {
    await delivery();
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.NOTIFICATION_MANAGE] } });
    expect((await run((request) => controller.getLogs(1, 20, request), { subjectType: "access_key" })).total).toBe(1);
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.NOTIFICATION_MANAGE] } });
    expect((await list()).total).toBe(0);
  });
  it("cannot list another user's logs even with wildcard policy or forged method userId", async () => {
    await delivery(peer);
    await delivery(foreign);
    await grant(action, "*");
    expect((await list()).total).toBe(0);
    await expect(run((request) => service.getLogs(peer, 1, 20, request))).rejects.toMatchObject({ statusCode: 403 });
    await expect(run((request) => service.getLogs(foreign, 1, 20, request))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not hydrate logs reparented after authorization", async () => {
    const own = await delivery();
    await grant(action);
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementationOnce(async (principal, rows) => {
      await prisma.notificationLog.update({ where: { id: own.id }, data: { userId: peer } });
      return original(principal, rows);
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks current account ownership before loading content", async () => {
    await delivery();
    await grant(action);
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementationOnce(async (principal, rows) => {
      await prisma.user.update({ where: { id: actor }, data: { accountOwnerId: foreign } });
      return original(principal, rows);
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a delivery-state change instead of returning a stale authorized snapshot", async () => {
    const own = await delivery();
    await grant(action);
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementationOnce(async (principal, rows) => {
      await prisma.notificationLog.update({ where: { id: own.id }, data: { deliveryStatus: "failed" } });
      return original(principal, rows);
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 409, messageKey: "errors.conflict" });
  });
  it("does not return selected content if a policy is revoked after the scan decisions", async () => {
    const own = await delivery();
    await grant(action);
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementationOnce(async (input) => {
      const result = await original(input);
      await grant(action, logArn(own.id), "Deny");
      return result;
    });
    const hydrate = vi.spyOn(repository, "hydrate");
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("fails closed for missing context or store failures, including empty collections", async () => {
    await expect(service.getLogs(actor, 1, 20)).rejects.toMatchObject({ statusCode: 403 });
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValueOnce(
      new Error("fixture policy unavailable"),
    );
    await expect(list()).rejects.toThrow("fixture policy unavailable");
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies resource-group scoped Deny as membership changes", async () => {
    const own = await delivery();
    await grant(action);
    const group = await ram.createResourceGroup(owner, { name: "history-group-" + randomUUID() });
    const policy = await ram.createPolicy(owner, {
      name: "history-deny-" + randomUUID(),
      document: { Version: "1", Statement: { Effect: "Deny", Action: action, Resource: "*" } },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    await ram.addResourceGroupMember(owner, group.id, { resourceArn: logArn(own.id) });
    expect((await list()).total).toBe(0);
    await prisma.ramResourceGroupMember.updateMany({ where: { resourceGroupId: group.id }, data: { status: 0 } });
    expect((await list()).total).toBe(1);
    const groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(logArn(own.id, peer), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(logArn(own.id.toUpperCase()), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(logArn(own.id, actor, foreign), foreign)).toBe(false);
  });
  it("merges group Deny and evaluates trusted transport Conditions", async () => {
    const own = await delivery();
    await grant(action);
    const group = await prisma.group.create({
      data: {
        username: "history-group-" + randomUUID(),
        name: "History fixture group",
        accountOwnerId: owner,
        permissions: [],
      },
    });
    await prisma.user.update({ where: { id: actor }, data: { groupId: group.id } });
    await grant(action, logArn(own.id), "Deny", "group", group.id, { Bool: { "acs:SecureTransport": false } });
    expect((await list()).total).toBe(1);
    expect(
      (
        await run((request) => {
          Object.defineProperty(request, "secure", { value: false });
          request.headers["x-secure-transport"] = "true";
          return controller.getLogs(1, 20, request);
        })
      ).total,
    ).toBe(0);
  });
  it("uses assumed role policies rather than subject-user grants and rechecks session revocation", async () => {
    await delivery();
    await grant(action);
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "history-role-" + randomUUID() } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "history",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { roleSessionId: session.id, assumedRoleId: role.id };
    expect((await run((request) => controller.getLogs(1, 20, request), auth)).total).toBe(0);
    await grant(action, "*", "Allow", "role", role.id);
    expect((await run((request) => controller.getLogs(1, 20, request), auth)).total).toBe(1);
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementationOnce(async (principal, rows) => {
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return original(principal, rows);
    });
    await expect(run((request) => controller.getLogs(1, 20, request), auth)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("reads beyond one bounded scan page with stable ordering and authorized totals", async () => {
    await prisma.notificationLog.createMany({
      data: Array.from({ length: 505 }, (_, index) => ({
        userId: actor,
        eventType: ALL_NOTIFICATION_EVENTS[0],
        title: "History " + index,
        content: "Fixture content",
        channel: "email",
        createTime: new Date(2026, 0, 1, 0, 0, index),
      })),
    });
    await grant(action);
    const result = await list(26, 20);
    expect(result.total).toBe(505);
    expect(result.logs).toHaveLength(5);
  });
  it("preserves authenticated event metadata, independently authorizes the actual user, and honors explicit Deny", async () => {
    const result = await run((request) => controller.getEventList(request));
    expect(result).toHaveLength(ALL_NOTIFICATION_EVENTS.length);
    await expect(run((request) => service.getAuthorizedEventList(peer, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await grant("quyan:notification:ListEvents", "acs:quyan:*:" + owner + ":user/" + actor, "Deny");
    await expect(run((request) => controller.getEventList(request))).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "keeps legacy log permission enforcement and self event access in %s mode",
    async (mode) => {
      await delivery();
      await grant(action, "*", "Deny");
      await grant("quyan:notification:ListEvents", "*", "Deny");
      env.security.iamAuthorizationMode = mode;
      await expect(list()).rejects.toMatchObject({ statusCode: 403 });
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.NOTIFICATION_MANAGE] } });
      expect((await list()).total).toBe(1);
      expect(await run((request) => controller.getEventList(request))).toHaveLength(ALL_NOTIFICATION_EVENTS.length);
    },
  );
});
