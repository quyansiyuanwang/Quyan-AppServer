import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { PlatformTicketReviewMutationIamService } from "@/services/ticket/platform-ticket-review-mutation-iam.service";
import { PlatformTicketReviewMutationRepository } from "@/store/ticket/platform-ticket-review-mutation.repository";
import { platformTicketReviewArn } from "@/iam/resources/platform-ticket-review-resources";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TicketReviewMutationInput } from "@/store/ticket/platform-ticket-review-mutation.store";
import type { TypedRequest } from "@/types/express";
import * as conditions from "@/iam/request/condition-context";
let owner: string,
  actor: string,
  submitter: string,
  groupId: string,
  ticketId: string,
  secondId: string,
  commentId: string;
const mode = env.security.iamAuthorizationMode,
  service = PlatformTicketReviewMutationIamService.getInstance(),
  repository = PlatformTicketReviewMutationRepository.getInstance(),
  engine = IamAuthorizationService.getInstance();
const update = "quyan:ticket:UpdateReviewTicket",
  comment = "quyan:ticket:AddReviewComment",
  remove = "quyan:ticket:DeleteReviewTicket";
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "review-write-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
async function bind(
  effect: "Allow" | "Deny",
  action: string,
  principalType = "user",
  principalId = actor,
  condition?: Record<string, Record<string, string>>,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: effect,
      Action: action,
      Resource: platformTicketReviewArn(submitter, ticketId),
      ...(condition ? { Condition: condition } : {}),
    },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "review-write-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  submitter = await user();
  groupId = (
    await prisma.group.create({
      data: {
        username: "review-write-group-" + randomUUID(),
        name: "fixture-global",
        level: 0,
        permissions: [Permission.TICKET_REVIEW_UPDATE],
        accountOwnerId: null,
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  const create = (title: string) =>
    prisma.ticket.create({
      data: {
        userId: submitter,
        type: "bug",
        title,
        description: "private-body",
        contactInfo: "private-contact",
        priority: "medium",
      },
    });
  ticketId = (await create("fixture-first")).id;
  secondId = (await create("fixture-second")).id;
  commentId = (
    await prisma.ticketComment.create({
      data: { ticketId, authorUserId: actor, content: "private-internal", visibility: "internal" },
    })
  ).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
const inputs: TicketReviewMutationInput[] = [
  { kind: "update", data: { priority: "high" } },
  { kind: "comment", data: { content: "fixture-comment", visibility: "public" } },
  { kind: "delete" },
];
describe("atomic platform ticket review resource mutations", () => {
  it("updates using write-only eligibility and returns the transaction detail", async () => {
    const result = await service.execute(
      ticketId,
      actor,
      { kind: "update", data: { priority: "high", workflowStatus: "processing", assigneeUserId: actor } },
      request(),
    );
    expect(result!.detail!.ticket).toMatchObject({
      priority: "high",
      workflowStatus: "processing",
      assigneeUserId: actor,
    });
    expect(result!.detail!.comments[0]!.content).toBe("private-internal");
    const preserved = await service.execute(
      ticketId,
      actor,
      { kind: "update", data: { priority: "low", assigneeUserId: undefined } },
      request(),
    );
    expect(preserved!.detail!.ticket.assigneeUserId).toBe(actor);
    const principal = {
      subjectUserId: actor,
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: "sub_user" as const,
    };
    await expect(
      engine.authorize({
        principal,
        action: "quyan:ticket:GetReviewTicket",
        resource: platformTicketReviewArn(submitter, ticketId),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("commits comment and reply timestamp together and preserves soft deletion", async () => {
    const result = await service.execute(
      ticketId,
      actor,
      { kind: "comment", data: { content: " fixture-comment ", visibility: "internal" } },
      request(),
    );
    expect(result!.comment).toMatchObject({ content: "fixture-comment", visibility: "internal", authorUserId: actor });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).lastReplyAt).toEqual(
      result!.comment!.createTime,
    );
    await service.execute(ticketId, actor, { kind: "delete" }, request());
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe(-1);
    expect(await prisma.ticketComment.count({ where: { ticketId } })).toBe(2);
  });
  it.each(inputs)("rejects matching action Deny without any mutation for %j", async (input) => {
    const action = input.kind === "update" ? update : input.kind === "comment" ? comment : remove;
    await bind("Deny", action, "group", groupId);
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    await expect(service.execute(ticketId, actor, input, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toEqual(before);
    expect(await prisma.ticketComment.count({ where: { ticketId } })).toBe(1);
  });
  it("does not authorize deletion from an update grant", async () => {
    await bind("Deny", remove);
    expect(
      (await service.execute(ticketId, actor, { kind: "update", data: { priority: "high" } }, request()))!.detail!
        .ticket.priority,
    ).toBe("high");
    await expect(service.execute(ticketId, actor, { kind: "delete" }, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["personal", "private", "disabled", "wrong"])(
    "requires persisted global update qualification for %s",
    async (kind) => {
      if (kind === "personal")
        await prisma.user.update({
          where: { id: actor },
          data: { groupId: null, permissionAdds: [Permission.TICKET_REVIEW_UPDATE] },
        });
      if (kind === "private") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      if (kind === "wrong")
        await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.TICKET_REVIEW_READ] } });
      await bind("Allow", update);
      await expect(service.execute(ticketId, actor, inputs[0]!, request())).rejects.toMatchObject({ statusCode: 403 });
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).priority).toBe("medium");
    },
  );
  it("rejects ticket content changes before locking despite preserved timestamps", async () => {
    const mutate = repository.mutate.bind(repository);
    vi.spyOn(repository, "mutate").mockImplementation(async (guard, input) => {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { description: "changed-source", updateTime: guard.target.updateTime },
      });
      return mutate(guard, input);
    });
    await expect(service.execute(ticketId, actor, inputs[0]!, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).priority).toBe("medium");
  });
  it("rejects ownership changes before a comment is inserted", async () => {
    const mutate = repository.mutate.bind(repository);
    vi.spyOn(repository, "mutate").mockImplementation(async (guard, input) => {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { userId: owner, updateTime: guard.target.updateTime },
      });
      return mutate(guard, input);
    });
    await expect(service.execute(ticketId, actor, inputs[1]!, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.ticketComment.count({ where: { ticketId } })).toBe(1);
  });
  it("rejects changed comments before an update response is read", async () => {
    const mutate = repository.mutate.bind(repository),
      before = await prisma.ticketComment.findUniqueOrThrow({ where: { id: commentId } });
    vi.spyOn(repository, "mutate").mockImplementation(async (guard, input) => {
      await prisma.ticketComment.update({
        where: { id: commentId },
        data: { content: "changed-source", updateTime: before.updateTime },
      });
      return mutate(guard, input);
    });
    await expect(service.execute(ticketId, actor, inputs[0]!, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).priority).toBe("medium");
  });
  it("rejects authorization changes between preparation and the transaction", async () => {
    const mutate = repository.mutate.bind(repository);
    vi.spyOn(repository, "mutate").mockImplementation(async (guard, input) => {
      await bind("Deny", update);
      return mutate(guard, input);
    });
    await expect(service.execute(ticketId, actor, inputs[0]!, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).priority).toBe("medium");
  });
  it.each(inputs)("rolls back writes rejected after SQL mutation for %j", async (input) => {
    const before = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } }),
      mutate = repository.mutate.bind(repository);
    let checks = 0;
    vi.spyOn(repository, "mutate").mockImplementation(async (guard, data) => {
      const recheck = guard.users.recheck;
      guard.users.recheck = async () => {
        await recheck();
        if (++checks >= 2) throw iamAccountDenied();
      };
      return mutate(guard, data);
    });
    await expect(service.execute(ticketId, actor, input, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(checks).toBe(2);
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toEqual(before);
    expect(await prisma.ticketComment.count({ where: { ticketId } })).toBe(1);
  });
  it("rechecks live conditions after a write and rolls back on Deny", async () => {
    await bind("Deny", update, "user", actor, { IpAddress: { "acs:SourceIp": "192.0.3.0/24" } });
    const original = conditions.requestConditionContext,
      mutate = repository.mutate.bind(repository);
    let changed = false;
    vi.spyOn(conditions, "requestConditionContext").mockImplementation((req, principal) => ({
      ...original(req, principal),
      "acs:SourceIp": changed ? "192.0.3.21" : "192.0.2.20",
    }));
    vi.spyOn(repository, "mutate").mockImplementation(async (guard, input) => {
      let checks = 0;
      const recheck = guard.users.recheck;
      guard.users.recheck = async () => {
        if (++checks >= 2) changed = true;
        await recheck();
      };
      return mutate(guard, input);
    });
    await expect(service.execute(ticketId, actor, inputs[0]!, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).priority).toBe("medium");
  });
  it("validates active assignees within the transaction", async () => {
    await prisma.user.update({ where: { id: submitter }, data: { status: 0 } });
    await expect(
      service.execute(
        ticketId,
        actor,
        { kind: "update", data: { priority: "high", assigneeUserId: submitter } },
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).priority).toBe("medium");
  });
  it("does not turn a committed operation into a post-commit denial", async () => {
    const mutate = repository.mutate.bind(repository);
    vi.spyOn(repository, "mutate").mockImplementation(async (...args) => {
      const result = await mutate(...args);
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      return result;
    });
    expect((await service.execute(ticketId, actor, inputs[0]!, request()))!.detail!.ticket.priority).toBe("high");
    await expect(service.execute(ticketId, actor, inputs[1]!, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires role write grants per resource and respects session revocation", async () => {
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "review-write-role-" + randomUUID() },
    });
    const session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        tokenJtiHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const req = request();
    req.authContext!.roleSessionId = session.id;
    req.authContext!.assumedRoleId = role.id;
    await expect(service.execute(ticketId, actor, inputs[0]!, req)).rejects.toMatchObject({ statusCode: 403 });
    await bind("Allow", update, "role", role.id);
    expect((await service.execute(ticketId, actor, inputs[0]!, req))!.detail!.ticket.priority).toBe("high");
    await expect(service.execute(secondId, actor, inputs[0]!, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.execute(ticketId, actor, inputs[1]!, req)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { status: 0 } });
    await expect(service.execute(ticketId, actor, inputs[0]!, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("enforces resource Deny for AccessKey identity", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    await bind("Deny", comment);
    await expect(service.execute(ticketId, actor, inputs[1]!, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("simulates shadow writes without persisting mutations", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const mutate = vi.spyOn(repository, "mutate");
    for (const input of inputs) await service.execute(ticketId, actor, input, request(), false);
    expect(mutate).not.toHaveBeenCalled();
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).priority).toBe("medium");
    expect(await prisma.ticketComment.count({ where: { ticketId } })).toBe(1);
  });
});
