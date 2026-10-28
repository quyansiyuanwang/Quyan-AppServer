import { PlatformCarpoolOrderWriteIamService } from "@/services/billing/platform-carpool-order-write-iam.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { CarpoolService } from "@/services/billing/carpool.service";
import { CarpoolRepository } from "@/store/billing/carpool.repository";
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
const accept = () => service.accept(ids[1]!, actor, request());
async function deny(id: string, action = "quyan:carpool:AcceptOrder") {
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
        permissions: [Permission.CARPOOL_ORDER_FULFILL],
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
const prepared = () => PlatformCarpoolOrderWriteIamService.getInstance().prepare(actor, request(), ids[1]!);
async function unchanged() {
  expect((await prisma.carpoolOrder.findUniqueOrThrow({ where: { id: ids[1]! } })).state).toBe("submitted");
  expect(await prisma.carpoolOrderEvent.count({ where: { orderId: ids[1]! } })).toBe(0);
}
describe("carpool order acceptance resources and transactions", () => {
  it("accepts only the selected submitted order and emits its event", async () => {
    expect(await accept()).toMatchObject({ id: ids[1], state: "accepted", upstreamCost: 5 });
    expect(await prisma.carpoolOrderEvent.findFirst({ where: { orderId: ids[1]!, type: "accepted" } })).toMatchObject({
      actorUserId: actor,
    });
    await expect(accept()).rejects.toMatchObject({ statusCode: 400 });
  });
  it("refuses explicit Deny without changing state or writing events", async () => {
    await deny(ids[1]!);
    await expect(accept()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("does not reuse read Actions for order acceptance", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
    await expect(accept()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it.each(["order", "member"])("refuses changed %s source data with unchanged timestamps", async (source) => {
    const guard = await prepared();
    if (source === "order")
      await prisma.carpoolOrder.update({
        where: { id: ids[1]! },
        data: { salePrice: 99, updateTime: guard!.target.record.updateTime },
      });
    else {
      const member = guard!.target.record.members[0]!;
      await prisma.carpoolMember.update({
        where: { id: member.id },
        data: { payableAmount: 99, updateTime: member.updateTime },
      });
    }
    await expect(
      CarpoolRepository.getInstance().withTransaction(async () => ({ id: ids[1]! }), guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rolls back both state and event on the final recheck", async () => {
    const authority = PlatformCarpoolOrderWriteIamService.getInstance(),
      original = authority.prepare.bind(authority);
    vi.spyOn(authority, "prepare").mockImplementation(async (...args) => {
      const guard = await original(...args),
        recheck = guard!.users.recheck;
      let calls = 0;
      guard!.users.recheck = async () => {
        await recheck();
        if (++calls === 2) throw iamAccountDenied();
      };
      return guard;
    });
    await expect(accept()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("refuses revocation after the operation has been prepared", async () => {
    const guard = await prepared();
    await deny(ids[1]!);
    await expect(
      CarpoolRepository.getInstance().withTransaction(async () => ({ id: ids[1]! }), guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("limits acceptance callbacks to the accepted state transition", async () => {
    const guard = await prepared();
    await expect(
      CarpoolRepository.getInstance().withTransaction(async (tx) => {
        await tx.carpoolOrder.update({
          where: { id: ids[1]! },
          data: { state: "accepted", acceptedAt: new Date(), upstreamCost: 0 },
        });
        return { id: ids[1]! };
      }, guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("does not permit account-owned groups to grant deployment qualification", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(accept()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("refuses removed qualification, expired sessions and missing request context", async () => {
    const req = request();
    req.authContext!.roleSessionId = "missing-session";
    req.authContext!.assumedRoleId = "missing-role";
    await expect(service.accept(ids[1]!, actor, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.accept(ids[1]!, actor)).rejects.toMatchObject({ statusCode: 403 });
    const guard = await prepared();
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await expect(
      CarpoolRepository.getInstance().withTransaction(async () => ({ id: ids[1]! }), guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("allows only one concurrent acceptance and one event", async () => {
    const results = await Promise.allSettled([accept(), accept()]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.carpoolOrderEvent.count({ where: { orderId: ids[1]!, type: "accepted" } })).toBe(1);
  });
});
