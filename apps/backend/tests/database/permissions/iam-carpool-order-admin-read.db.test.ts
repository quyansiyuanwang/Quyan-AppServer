import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { CarpoolService } from "@/services/billing/carpool.service";
import { CarpoolRepository, carpoolOrderInclude } from "@/store/billing/carpool.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { Permission } from "@quyan/shared";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformCarpoolOrderArn } from "@/iam/resources/platform-carpool-resources";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = CarpoolService.getInstance();
let owner: string, actor: string, groupId: string, monthlyId: string, templateId: string, prefix: string, ids: string[];
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const list = (state?: string, page = 1, pageSize = 20, keyword?: string) =>
  service.listAdmin(state, page, pageSize, keyword, request());
const get = (id = ids[0]!) => service.getOrder(id, actor, true, request());
async function deny(id: string, action = "quyan:carpool:ListAdminOrders") {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: action, Resource: platformCarpoolOrderArn(id) },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: prefix + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
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
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "carpool-read-" + randomUUID();
  ids = [];
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: prefix + randomUUID(),
          password: "fixture-only",
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: {
        username: prefix,
        name: "Fixture carpool reader",
        accountOwnerId: null,
        permissions: [Permission.CARPOOL_ORDER_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  monthlyId = (await prisma.monthlyPassTemplate.create({ data: { name: prefix, defaultQuota: 100 } })).id;
  templateId = (
    await prisma.carpoolPackageTemplate.create({
      data: {
        name: prefix,
        salePrice: 10,
        upstreamCost: 5,
        maxMembers: 3,
        monthlyPassTemplateId: monthlyId,
        snapshotQuota: 100,
        snapshotValidityDays: 30,
      },
    })
  ).id;
  for (const [index, state] of ["accepted", "submitted", "open", "cancelled"].entries())
    ids.push(
      (
        await prisma.carpoolOrder.create({
          data: {
            ownerUserId: actor,
            packageTemplateId: templateId,
            monthlyPassTemplateId: monthlyId,
            packageName: prefix,
            salePrice: 10,
            upstreamCost: 5,
            maxMembers: 3,
            totalQuota: 100,
            validityDays: 30,
            state,
            createTime: new Date(Date.UTC(2026, 9, index + 1)),
            submittedAt: index < 2 ? new Date(Date.UTC(2026, 9, index + 1)) : null,
            members: { create: { userId: actor, role: "owner" } },
          },
        })
      ).id,
    );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.carpoolOrder.deleteMany({ where: { packageTemplateId: templateId } });
  await prisma.carpoolPackageTemplate.delete({ where: { id: templateId } });
  await prisma.monthlyPassTemplate.delete({ where: { id: monthlyId } });
  env.security.iamAuthorizationMode = mode;
});
describe("carpool operations resource reads", () => {
  it("preserves work ordering, state counts and management costs without legacy reads", async () => {
    const legacy = vi.spyOn(CarpoolRepository.getInstance(), "findOrdersForAdmin");
    const result = await list();
    expect(result).toMatchObject({ total: 4, stateCounts: { accepted: 1, submitted: 1, open: 1, cancelled: 1 } });
    expect(result.records.map((row) => row.id)).toEqual([ids[0], ids[1], ids[3], ids[2]]);
    expect(result.records[0]).toMatchObject({ upstreamCost: 5, members: [expect.objectContaining({ userId: actor })] });
    expect(legacy).not.toHaveBeenCalled();
  });
  it("filters total, table rows and state counters using the same admitted population", async () => {
    await deny(ids[0]!);
    const result = await list();
    expect(result.total).toBe(3);
    expect(result.stateCounts).toEqual({ submitted: 1, open: 1, cancelled: 1 });
    expect(result.records.map((row) => row.id)).not.toContain(ids[0]);
    expect(await list("accepted")).toMatchObject({ total: 0, records: [], stateCounts: result.stateCounts });
    expect((await list(undefined, 2, 1)).records.map((row) => row.id)).toEqual([ids[3]]);
  });
  it("keeps detail and listing permissions independent", async () => {
    await deny(ids[0]!, "quyan:carpool:GetAdminOrder");
    expect((await list()).total).toBe(4);
    await expect(get()).rejects.toMatchObject({ statusCode: 403 });
    expect((await get(ids[1]!)).id).toBe(ids[1]);
  });
  it("does not hydrate denied orders or load token credentials", async () => {
    await deny(ids[0]!);
    const transaction = prisma.$transaction.bind(prisma),
      reads: Prisma.CarpoolOrderFindFirstArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const find = tx.carpoolOrder.findFirst.bind(tx.carpoolOrder);
        vi.spyOn(tx.carpoolOrder, "findFirst").mockImplementation((args) => {
          if (args?.include) reads.push(args);
          return find(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await list();
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.some((args) => args.where?.id === ids[0])).toBe(false);
    expect(carpoolOrderInclude.members.include.relayToken).toEqual({ select: { id: true } });
    expect(carpoolOrderInclude.members.include.user).toEqual({ select: { username: true } });
  });
  it("returns an empty population and refuses detail without any Allow", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
    expect(await list()).toEqual({ total: 0, records: [], stateCounts: {} });
    await expect(get()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses keyword and state filters only within permitted results", async () => {
    await deny(ids[1]!);
    expect(await list(undefined, 1, 20, prefix)).toMatchObject({ total: 3 });
    expect(await list(undefined, 1, 20, "missing-fixture")).toEqual({ total: 0, records: [], stateCounts: {} });
    expect(await list("submitted")).toMatchObject({ total: 0, records: [] });
  });
  it("rechecks every used decision before returning records or counters", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let calls = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (args) => {
      const result = await original(args);
      return ++calls > 1
        ? result.map((row) => ({ ...row, decision: "ExplicitDeny", reason: "explicit-deny" }))
        : result;
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses forged accounts, account-owned groups, disabled identity and missing sessions", async () => {
    const forged = request();
    forged.authContext!.accountOwnerId = "foreign";
    await expect(service.listAdmin(undefined, 1, 20, undefined, forged)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: null } });
    const assumed = request();
    assumed.authContext!.roleSessionId = "missing-session";
    assumed.authContext!.assumedRoleId = "missing-role";
    await expect(service.listAdmin(undefined, 1, 20, undefined, assumed)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(get()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not fall back for missing request contexts or malformed resource identities", async () => {
    await expect(service.listAdmin()).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.getOrder(ids[0]!, actor, true)).rejects.toMatchObject({ statusCode: 403 });
    await expect(get("../invalid")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("accepts AccessKey subjects through the same server identity model", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    expect((await service.listAdmin(undefined, 1, 20, undefined, req)).total).toBe(4);
  });
});
