import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { TicketRepository } from "@/store/ticket/ticket.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { OwnTicketIamService } from "@/services/ticket/own-ticket-iam.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { ticketArn } from "@/iam/resources/ticket-resources";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, other: string, foreign: string;
const repository = TicketRepository.getInstance(),
  groups = RamResourceGroupRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "ticket-fixture-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  other = await user(owner);
  foreign = await user();
});
const ticket = (userId = actor) =>
  repository.create({
    userId,
    type: "bug",
    title: "fixture",
    description: "private-body",
    contactInfo: "private-contact",
    workflowStatus: "pending",
    priority: "medium",
  });
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
describe("own ticket storage authorization boundaries", () => {
  it("scans metadata only within active ownership and enforces fresh hydration snapshots", async () => {
    const row = await ticket();
    await ticket(other);
    await ticket(foreign);
    const targets = await repository.scanOwnTargets(actor, owner, { page: 1, pageSize: 10 });
    expect(targets).toHaveLength(1);
    expect(targets[0]).not.toHaveProperty("description");
    expect(targets[0]).not.toHaveProperty("contactInfo");
    expect(await repository.findOwnTarget(row.id, other, owner)).toBeNull();
    expect(await repository.scanOwnTargets(actor, foreign, { page: 1, pageSize: 10 })).toEqual([]);
    await prisma.ticket.update({
      where: { id: row.id },
      data: { updateTime: new Date(row.updateTime.getTime() + 1000) },
    });
    expect(await repository.readOwnTargets(actor, owner, targets)).toEqual([]);
    await expect(repository.readOwnDetail(actor, owner, targets[0])).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.updateOwnTarget(targets[0], owner, { title: "overwrite" })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("reads only public comments and refuses stale or terminal comment writes atomically", async () => {
    const row = await ticket();
    await repository.createComment({
      ticketId: row.id,
      authorUserId: owner,
      content: "private internal",
      visibility: "internal",
    });
    await repository.createComment({ ticketId: row.id, authorUserId: actor, content: "public", visibility: "public" });
    const target = (await repository.findOwnTarget(row.id, actor, owner))!;
    const detail = await repository.readOwnDetail(actor, owner, target);
    expect(detail.comments.map((comment) => comment.content)).toEqual(["public"]);
    await prisma.ticket.update({ where: { id: row.id }, data: { workflowStatus: "completed" } });
    await expect(
      repository.commentOwnTarget(target, owner, {
        ticketId: row.id,
        authorUserId: actor,
        content: "new",
        visibility: "public",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.ticketComment.count({ where: { ticketId: row.id } })).toBe(2);
    const terminal = (await repository.findOwnTarget(row.id, actor, owner))!;
    await expect(repository.updateOwnTarget(terminal, owner, { title: "change" })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("creates and appends comments only within the trusted account and declared owner", async () => {
    const row = await ticket(),
      target = (await repository.findOwnTarget(row.id, actor, owner))!;
    await expect(
      repository.createInAccount(
        {
          userId: actor,
          type: "bug",
          title: "fixture",
          description: "private",
          workflowStatus: "pending",
          priority: "medium",
        },
        foreign,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      repository.commentOwnTarget(target, owner, {
        ticketId: row.id,
        authorUserId: other,
        content: "forged",
        visibility: "public",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      repository.commentOwnTarget(target, owner, {
        ticketId: row.id,
        authorUserId: actor,
        content: "forged",
        visibility: "internal",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const comment = await repository.commentOwnTarget(target, owner, {
      ticketId: row.id,
      authorUserId: actor,
      content: "allowed",
      visibility: "public",
    });
    expect(comment.authorUserId).toBe(actor);
    const current = (await repository.findOwnTarget(row.id, actor, owner))!;
    expect(current.lastReplyAt?.getTime()).toBe(comment.createTime.getTime());
  });
  it("validates exact resource-group ownership and rejects disabled or deleted resources", async () => {
    const row = await ticket();
    expect(await groups.resourceExistsInAccount(ticketArn(owner, actor, row.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(ticketArn(foreign, actor, row.id), foreign)).toBe(false);
    expect(await groups.resourceExistsInAccount(ticketArn(owner, actor, row.id.toUpperCase()), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(ticketArn(owner, other, row.id), owner)).toBe(false);
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    expect(await groups.resourceExistsInAccount(ticketArn(owner, actor, row.id), owner)).toBe(false);
  });
  it("keeps nullable reply cursors deterministic and inside the account/owner boundary", async () => {
    const a = await ticket(),
      b = await ticket(),
      c = await ticket();
    await ticket(other);
    const time = new Date("2026-10-12T00:00:00Z");
    await prisma.ticket.update({
      where: { id: a.id },
      data: { lastReplyAt: new Date("2026-10-12T03:00:00Z"), createTime: time },
    });
    await prisma.ticket.update({
      where: { id: b.id },
      data: { lastReplyAt: new Date("2026-10-12T02:00:00Z"), createTime: time },
    });
    await prisma.ticket.update({ where: { id: c.id }, data: { lastReplyAt: null, createTime: time } });
    const rows = await repository.scanOwnTargets(actor, owner, { page: 1, pageSize: 10 });
    expect(rows.map((row) => row.id)).toEqual([a.id, b.id, c.id]);
    expect(
      (await repository.scanOwnTargets(actor, owner, { page: 1, pageSize: 10 }, rows[0])).map((row) => row.id),
    ).toEqual([b.id, c.id]);
    expect(
      (await repository.scanOwnTargets(actor, owner, { page: 1, pageSize: 10 }, rows[1])).map((row) => row.id),
    ).toEqual([c.id]);
    expect(await repository.scanOwnTargets(actor, owner, { page: 1, pageSize: 10 }, rows[2])).toEqual([]);
  });
  it("evaluates actual identity policies before pagination and denies revoked grants", async () => {
    const first = await ticket(),
      second = await ticket();
    const action = "quyan:ticket:ListOwnTickets",
      parsed = parseIamPolicy({
        Version: "1",
        Statement: [
          { Effect: "Allow", Action: action, Resource: "acs:ticket:*:" + owner + ":ticket/" + actor + "/*" },
          { Effect: "Deny", Action: action, Resource: ticketArn(owner, actor, second.id) },
        ],
      });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "ticket-policy-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    const authorization = await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "user",
        principalId: actor,
        policyId: policy.id,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
    expect(await OwnTicketIamService.getInstance().list(actor, { page: 1, pageSize: 1 }, request())).toMatchObject({
      total: 1,
      items: [{ id: first.id }],
    });
    await prisma.ramAuthorization.update({ where: { id: authorization.id }, data: { status: -1 } });
    expect(await OwnTicketIamService.getInstance().list(actor, { page: 1, pageSize: 1 }, request())).toEqual({
      total: 0,
      items: [],
    });
  });
});
