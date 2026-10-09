import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ALL_NOTIFICATION_EVENTS, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RamService } from "@/services/users/ram.service";
import { NotificationController } from "@/api/controllers/v1/notification/notification.controller";
import { NotificationManagementService } from "@/services/notification/notification-management.service";
import { NotificationInboxManagementRepository } from "@/store/notification/notification-inbox-management.repository";
import { notificationInboxItemArn } from "@/iam/resources/notification-resources";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import BusinessLogService from "@/services/system/businesslog.service";
import { setRequestContext } from "@/util/request-context";
import type { TypedRequest } from "@/types/express";

const ram = RamService.getInstance(),
  controller = new NotificationController(),
  service = NotificationManagementService.getInstance();
const repository = NotificationInboxManagementRepository.getInstance();
const originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string;

const run = <T>(operation: (request: TypedRequest) => Promise<T>, auth = {}, userId = actor) =>
  new AsyncResource("notification-inbox-fixture").runInAsyncScope(async () => {
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
const actions = [
  "quyan:notification:ListInbox",
  "quyan:notification:MarkInboxRead",
  "quyan:notification:ConfirmPixelOpenedInboxRead",
];
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

const inboxArn = (itemId: string, userId = actor, accountId = owner) =>
  notificationInboxItemArn(accountId, userId, itemId);
async function message(userId = actor, data = {}) {
  return prisma.notificationInboxItem.create({
    data: {
      userId,
      eventType: ALL_NOTIFICATION_EVENTS[0],
      title: "Fixture inbox",
      content: "Fixture content",
      ...data,
    },
  });
}
const list = (page = 1, pageSize = 20, unreadOnly = false) =>
  run((request) => controller.getInbox(page, pageSize, unreadOnly, request));
const mark = (ids: string[]) => run((request) => controller.markInboxRead({ ids }, request));
const read = (id: string) => prisma.notificationInboxItem.findUniqueOrThrow({ where: { id } });

describe("resource-level authenticated self inbox", () => {
  it("preserves authenticated self-service with no legacy permission and isolates peers/foreign accounts", async () => {
    const own = await message();
    await message(peer);
    await message(foreign);
    const result = await list();
    expect(result).toMatchObject({ total: 1, unreadCount: 1, pixelOpenedUnreadCount: 0 });
    expect(result.items.map((item) => item.id)).toEqual([own.id]);
    expect(result.items[0]).not.toHaveProperty("userId");
    expect(await mark([own.id])).toEqual({ success: true, count: 1 });
    expect(await read(own.id)).toMatchObject({ isRead: true, readSource: "manual" });
  });
  it("filters Deny before pagination and returns only authorized totals, unread and opened counts", async () => {
    const denied = await message(actor, { pixelOpened: true });
    const allowed = await message();
    const alreadyRead = await message(actor, { isRead: true });
    await grant(actions[0], inboxArn(denied.id), "Deny");
    expect(await list(1, 1)).toMatchObject({
      total: 2,
      unreadCount: 1,
      pixelOpenedUnreadCount: 0,
      items: [{ id: allowed.id }],
    });
    expect(await list(2, 1)).toMatchObject({ total: 2, items: [{ id: alreadyRead.id }] });
    expect(await list(1, 20, true)).toMatchObject({ total: 1, unreadCount: 1, items: [{ id: allowed.id }] });
  });
  it("keeps list and mutation authorization independent", async () => {
    const item = await message();
    await grant(actions[0], inboxArn(item.id), "Deny");
    expect((await list()).total).toBe(0);
    expect((await mark([item.id])).count).toBe(1);
  });
  it("atomically rejects a requested mixed-Allow/Deny batch including a denial after the first ID", async () => {
    const one = await message(),
      two = await message();
    await grant(actions[1], inboxArn(two.id), "Deny");
    await expect(mark([one.id, two.id])).rejects.toMatchObject({ statusCode: 403 });
    expect((await read(one.id)).isRead).toBe(false);
    expect((await read(two.id)).isRead).toBe(false);
  });
  it.each(["peer", "foreign", "missing", "case-alias", "inactive"])(
    "rejects %s targets without mutating valid batch elements",
    async (kind) => {
      const own = await message();
      const other =
        kind === "peer" ? await message(peer) : kind === "foreign" ? await message(foreign) : await message();
      if (kind === "inactive")
        await prisma.notificationInboxItem.update({ where: { id: other.id }, data: { status: 0 } });
      const id = kind === "missing" ? "nonexistent" : kind === "case-alias" ? other.id.toUpperCase() : other.id;
      await expect(mark([own.id, id])).rejects.toMatchObject({ statusCode: 403 });
      expect((await read(own.id)).isRead).toBe(false);
    },
  );
  it("deduplicates targets and treats already-read messages as an authorized no-op", async () => {
    const own = await message();
    expect((await mark([own.id, own.id])).count).toBe(1);
    expect((await mark([own.id])).count).toBe(0);
  });
  it("markAll only updates allowed own unread resources; explicit Deny and peer messages remain untouched", async () => {
    const one = await message(),
      two = await message(),
      other = await message(peer);
    await grant(actions[1], inboxArn(two.id), "Deny");
    expect(await run((request) => controller.markInboxRead({ markAll: true }, request))).toEqual({
      success: true,
      count: 1,
    });
    expect((await read(one.id)).isRead).toBe(true);
    expect((await read(two.id)).isRead).toBe(false);
    expect((await read(other.id)).isRead).toBe(false);
  });
  it("confirms only allowed unread messages with opened pixels and uses its distinct Action", async () => {
    const opened = await message(actor, { pixelOpened: true }),
      denied = await message(actor, { pixelOpened: true }),
      unopened = await message();
    await grant(actions[2], inboxArn(denied.id), "Deny");
    expect(await run((request) => controller.confirmPixelOpenedRead(request))).toEqual({ success: true, count: 1 });
    expect(await read(opened.id)).toMatchObject({ isRead: true, readSource: "pixel" });
    expect((await read(denied.id)).isRead).toBe(false);
    expect((await read(unopened.id)).isRead).toBe(false);
  });
  it("ignores forged actor/action headers but fails closed for mismatched or missing service context", async () => {
    const own = await message();
    await run(async (request) => {
      await expect(service.getInbox(peer, 1, 20, false, request)).rejects.toMatchObject({ statusCode: 403 });
      request.authContext = undefined;
      await expect(service.markInboxRead(actor, { ids: [own.id] }, request)).rejects.toMatchObject({ statusCode: 403 });
    });
    await expect(service.getInbox(actor, 1, 20, false)).rejects.toMatchObject({ statusCode: 403 });
    expect((await read(own.id)).isRead).toBe(false);
  });
  it("rechecks actor/account ownership inside the final mutation transaction", async () => {
    const own = await message();
    const original = repository.markRead.bind(repository);
    vi.spyOn(repository, "markRead").mockImplementationOnce(async (principal, rows, source) => {
      await prisma.user.update({ where: { id: actor }, data: { accountOwnerId: foreign } });
      return original(principal, rows, source);
    });
    await expect(mark([own.id])).rejects.toMatchObject({ statusCode: 403 });
    expect((await read(own.id)).isRead).toBe(false);
  });
  it("does not hydrate content or mutate a message reassigned after authorization", async () => {
    const own = await message();
    const original = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementationOnce(async (principal, rows) => {
      await prisma.notificationInboxItem.update({ where: { id: own.id }, data: { userId: peer } });
      return original(principal, rows);
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    expect((await read(own.id)).isRead).toBe(false);
  });
  it("checks authorized snapshots before all writes, rolling back changed mixed batches", async () => {
    const one = await message(),
      two = await message();
    const original = repository.markRead.bind(repository);
    vi.spyOn(repository, "markRead").mockImplementationOnce(async (principal, rows, source) => {
      await prisma.notificationInboxItem.update({ where: { id: two.id }, data: { title: "Concurrent revision" } });
      return original(principal, rows, source);
    });
    await expect(mark([one.id, two.id])).rejects.toMatchObject({ statusCode: 409, messageKey: "errors.conflict" });
    expect((await read(one.id)).isRead).toBe(false);
  });
  it("loads current policy and identity even for empty collections", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValueOnce(
      new Error("fixture policy unavailable"),
    );
    await expect(list()).rejects.toThrow("fixture policy unavailable");
  });
  it("recognizes inbox resource-group membership only in the correct account and exact user/message identity", async () => {
    const own = await message();
    const groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(inboxArn(own.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(inboxArn(own.id, peer), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(inboxArn(own.id, actor, foreign), foreign)).toBe(false);
    expect(await groups.resourceExistsInAccount(inboxArn(own.id.toUpperCase()), owner)).toBe(false);
  });
  it("supports group explicit Deny over authenticated self-service", async () => {
    const own = await message();
    const group = await prisma.group.create({
      data: {
        username: "inbox-group-" + randomUUID(),
        name: "Inbox fixture group",
        accountOwnerId: owner,
        permissions: [],
      },
    });
    await prisma.user.update({ where: { id: actor }, data: { groupId: group.id } });
    await grant(actions[1], inboxArn(own.id), "Deny", "group", group.id);
    await expect(mark([own.id])).rejects.toMatchObject({ statusCode: 403 });
    expect((await read(own.id)).isRead).toBe(false);
  });
  it("does not inherit user Deny into assumed role policies but checks the session before writes", async () => {
    const own = await message();
    await grant(actions, "*", "Deny");
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "inbox-role-" + randomUUID() } });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "inbox",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const auth = { assumedRoleId: role.id, roleSessionId: session.id };
    expect((await run((request) => controller.getInbox(1, 20, false, request), auth)).total).toBe(1);
    const original = repository.markRead.bind(repository);
    vi.spyOn(repository, "markRead").mockImplementationOnce(async (principal, rows, source) => {
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return original(principal, rows, source);
    });
    await expect(run((request) => controller.markInboxRead({ ids: [own.id] }, request), auth)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await read(own.id)).isRead).toBe(false);
  });
  it("scans beyond one bounded authorization page without leaking denied counts", async () => {
    const rows = Array.from({ length: 505 }, (_, index) => ({
      userId: actor,
      eventType: ALL_NOTIFICATION_EVENTS[0],
      title: "Fixture " + index,
      content: "Fixture content",
      createTime: new Date(2026, 0, 1, 0, 0, index),
      pixelOpened: index % 2 === 0,
    }));
    await prisma.notificationInboxItem.createMany({ data: rows });
    const result = await list(26, 20);
    expect(result).toMatchObject({ total: 505, unreadCount: 505, pixelOpenedUnreadCount: 253 });
    expect(result.items).toHaveLength(5);
    expect(await run((request) => controller.markInboxRead({ markAll: true }, request))).toEqual({
      success: true,
      count: 505,
    });
    expect(await prisma.notificationInboxItem.count({ where: { userId: actor, isRead: false } })).toBe(0);
  });
  it("applies resource-group Deny immediately as messages enter and leave the group", async () => {
    const own = await message();
    const group = await ram.createResourceGroup(owner, { name: "inbox-resources-" + randomUUID() });
    const policy = await ram.createPolicy(owner, {
      name: "inbox-group-deny-" + randomUUID(),
      document: { Version: "1", Statement: { Effect: "Deny", Action: actions[1], Resource: "*" } },
    });
    await ram.createAuthorization(owner, {
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "resource-group",
      scopeResourceId: group.id,
    });
    await ram.addResourceGroupMember(owner, group.id, { resourceArn: inboxArn(own.id) });
    await expect(mark([own.id])).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramResourceGroupMember.updateMany({ where: { resourceGroupId: group.id }, data: { status: 0 } });
    expect((await mark([own.id])).count).toBe(1);
  });
  it("evaluates trusted request Conditions on per-message decisions", async () => {
    const own = await message();
    await grant(actions[1], inboxArn(own.id), "Deny", "user", actor, { Bool: { "acs:SecureTransport": false } });
    await expect(
      run((request) => {
        Object.defineProperty(request, "secure", { value: false });
        request.headers["x-secure-transport"] = "true";
        return controller.markInboxRead({ ids: [own.id] }, request);
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await read(own.id)).isRead).toBe(false);
    expect((await mark([own.id])).count).toBe(1);
  });
  it("rejects a disabled account even for an empty list and no-op collection mutations", async () => {
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    await expect(run((request) => controller.markInboxRead({ markAll: true }, request))).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(run((request) => controller.confirmPixelOpenedRead(request))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["legacy", "shadow"] as const)("preserves authenticated self operations in %s mode", async (mode) => {
    const own = await message();
    await grant(actions, "*", "Deny");
    env.security.iamAuthorizationMode = mode;
    expect((await list()).total).toBe(1);
    expect((await mark([own.id])).count).toBe(1);
  });
});
