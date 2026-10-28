import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { PlatformTicketReviewReadIamService } from "@/services/ticket/platform-ticket-review-read-iam.service";
import { PlatformTicketReviewReadRepository } from "@/store/ticket/platform-ticket-review-read.repository";
import { platformTicketReviewArn } from "@/iam/resources/platform-ticket-review-resources";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
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
  service = PlatformTicketReviewReadIamService.getInstance(),
  repository = PlatformTicketReviewReadRepository.getInstance(),
  engine = IamAuthorizationService.getInstance();
const listAction = "quyan:ticket:ListReviewTickets",
  detailAction = "quyan:ticket:GetReviewTicket";
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "review-fixture-" + randomUUID(),
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
    headers: { "x-action": "*", "x-account-id": "forged" },
    ip: "192.0.2.20",
    secure: true,
  }) as unknown as TypedRequest;
async function bind(
  effect: "Allow" | "Deny",
  action: string | string[],
  id = ticketId,
  principalType = "user",
  principalId = actor,
  condition?: Record<string, Record<string, string>>,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: effect,
      Action: action,
      Resource: platformTicketReviewArn(submitter, id),
      ...(condition ? { Condition: condition } : {}),
    },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "review-fixture-" + randomUUID(),
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
  return policy;
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
  submitter = await user();
  groupId = (
    await prisma.group.create({
      data: {
        username: "review-group-" + randomUUID(),
        name: "fixture-global",
        level: 0,
        permissions: [Permission.TICKET_REVIEW_READ],
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
describe("persisted platform ticket review read boundaries", () => {
  it("uses metadata-only scans and stable ticket ownership resources", async () => {
    const principal = {
      subjectUserId: actor,
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: "sub_user" as const,
    };
    const targets = await repository.scan(
      principal,
      await repository.where({ page: 1, pageSize: 20, userId: submitter }),
    );
    expect(targets).toHaveLength(2);
    expect(targets[0]).not.toHaveProperty("title");
    expect(targets[0]).not.toHaveProperty("contactInfo");
    expect(targets[0]!.revision).toMatch(/^[a-f0-9]{64}$/);
    const result = await service.list({ userId: submitter, pageSize: 1 }, request());
    expect(result).toMatchObject({ total: 2, hasMore: true, pageSize: 1 });
    expect(result.items).toHaveLength(1);
    expect((await service.detail(ticketId, request()))!.comments[0]!.content).toBe("private-internal");
  });
  it("filters group Deny before page totals and hydration", async () => {
    await bind("Deny", listAction, ticketId, "group", groupId);
    const hydrate = vi.spyOn(repository, "hydrate");
    const result = await service.list({ userId: submitter, pageSize: 1 }, request());
    expect(result).toMatchObject({ total: 1, hasMore: false, items: [{ id: secondId }] });
    expect(hydrate.mock.calls[0]![1].map((row) => row.id)).toEqual([secondId]);
  });
  it("denies detail before loading comments or contact data", async () => {
    await bind("Deny", detailAction);
    const detail = vi.spyOn(repository, "detail"),
      comments = vi.spyOn(repository, "comments");
    await expect(service.detail(ticketId, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(detail).not.toHaveBeenCalled();
    expect(comments).not.toHaveBeenCalled();
  });
  it("does not replace detail permission with list permission", async () => {
    await bind("Deny", detailAction);
    expect((await service.list({ userId: submitter }, request())).total).toBe(2);
    await expect(service.detail(ticketId, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["personal", "private", "disabled", "wrong"])("requires actual global qualification for %s", async (kind) => {
    if (kind === "personal")
      await prisma.user.update({
        where: { id: actor },
        data: { groupId: null, permissionAdds: [Permission.TICKET_REVIEW_READ] },
      });
    if (kind === "private") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    if (kind === "disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
    if (kind === "wrong")
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.TICKET_REVIEW_UPDATE] } });
    await bind("Allow", [listAction, detailAction]);
    await expect(service.list({ userId: submitter }, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.detail(ticketId, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects ticket content changes after hydration despite unchanged timestamps", async () => {
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (principal, targets) => {
      const rows = await hydrate(principal, targets);
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { description: "changed-body", updateTime: rows.find((row) => row.id === ticketId)!.updateTime },
      });
      return rows;
    });
    await expect(service.list({ userId: submitter }, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects owner changes before locked detail hydration", async () => {
    const detail = repository.detail.bind(repository);
    vi.spyOn(repository, "detail").mockImplementation(async (principal, target, comments) => {
      await prisma.ticket.update({ where: { id: ticketId }, data: { userId: owner, updateTime: target.updateTime } });
      return detail(principal, target, comments);
    });
    await expect(service.detail(ticketId, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects comment edits with preserved timestamps after detail hydration", async () => {
    const detail = repository.detail.bind(repository);
    vi.spyOn(repository, "detail").mockImplementation(async (...args) => {
      const result = await detail(...args);
      await prisma.ticketComment.update({
        where: { id: commentId },
        data: { content: "changed-comment", updateTime: result.comments[0]!.updateTime },
      });
      return result;
    });
    await expect(service.detail(ticketId, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects comments inserted after authorized detail hydration", async () => {
    const detail = repository.detail.bind(repository);
    vi.spyOn(repository, "detail").mockImplementation(async (...args) => {
      const result = await detail(...args);
      await prisma.ticketComment.create({ data: { ticketId, authorUserId: actor, content: "new-comment" } });
      return result;
    });
    await expect(service.detail(ticketId, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects related usernames edited after source hydration", async () => {
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const result = await hydrate(...args);
      await prisma.user.update({ where: { id: submitter }, data: { username: "changed-fixture-" + randomUUID() } });
      return result;
    });
    await expect(service.list({ userId: submitter }, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects group revocation after hydration", async () => {
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const result = await hydrate(...args);
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      return result;
    });
    await expect(service.list({ userId: submitter }, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks live source-IP conditions before returning a detail", async () => {
    await bind("Deny", detailAction, ticketId, "user", actor, { IpAddress: { "acs:SourceIp": "192.0.3.0/24" } });
    const original = conditions.requestConditionContext,
      detail = repository.detail.bind(repository);
    let changed = false;
    vi.spyOn(conditions, "requestConditionContext").mockImplementation((req, principal) => ({
      ...original(req, principal),
      "acs:SourceIp": changed ? "192.0.3.21" : "192.0.2.20",
    }));
    vi.spyOn(repository, "detail").mockImplementation(async (...args) => {
      const result = await detail(...args);
      changed = true;
      return result;
    });
    await expect(service.detail(ticketId, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("runs shadow metadata evaluation without private content reads", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const hydrate = vi.spyOn(repository, "hydrate"),
      detail = vi.spyOn(repository, "detail");
    await service.list({ userId: submitter }, request(), false);
    await service.detail(ticketId, request(), false);
    expect(hydrate).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });
  it("uses role policies without inheriting actor management Allow", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "review-role-" + randomUUID() } });
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
    await expect(service.detail(ticketId, req)).rejects.toMatchObject({ statusCode: 403 });
    expect((await service.list({ userId: submitter }, req)).total).toBe(0);
    await bind("Allow", [listAction, detailAction], ticketId, "role", role.id);
    expect((await service.detail(ticketId, req))!.ticket.id).toBe(ticketId);
    expect((await service.list({ userId: submitter }, req)).items.map((row) => row.id)).toEqual([ticketId]);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { status: 0 } });
    await expect(service.detail(ticketId, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies resource Deny to authenticated AccessKey principals", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    await bind("Deny", detailAction);
    await expect(service.detail(ticketId, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses client-controlled resource owners in the evaluator", async () => {
    const principal = {
      subjectUserId: actor,
      principalUserId: actor,
      accountOwnerId: owner,
      subjectType: "sub_user" as const,
    };
    expect(
      (
        await engine.authorize({
          principal,
          action: detailAction,
          resource: "acs:ticket:*:" + submitter + ":ticket/" + submitter + "/" + ticketId,
        })
      ).decision,
    ).toBe("ImplicitDeny");
    await expect(service.detail("missing-id", request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
