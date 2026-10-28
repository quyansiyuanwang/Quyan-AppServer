import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { CarpoolService } from "@/services/billing/carpool.service";
import { CarpoolRepository } from "@/store/billing/carpool.repository";
import { PlatformCarpoolOrderRefundIamService } from "@/services/billing/platform-carpool-order-refund-iam.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { Permission } from "@quyan/shared";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  platformCarpoolOrderArn,
  platformCarpoolRefundAccountArn,
  platformCarpoolRefundLedgerArn,
} from "@/iam/resources/platform-carpool-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = CarpoolService.getInstance(),
  authority = PlatformCarpoolOrderRefundIamService.getInstance();
let owner: string,
  actor: string,
  groupId: string,
  monthlyId: string,
  templateId: string,
  orderId: string,
  prefix: string,
  payers: string[],
  reservations: string[];
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const fail = () => service.fail(orderId, "Fixture refund", actor, request());
const prepared = () => authority.prepare(actor, request(), orderId, "Fixture refund");
async function deny(resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:carpool:FailOrder", Resource: resource },
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
  prefix = "carpool-refund-" + randomUUID();
  payers = [];
  reservations = [];
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
  payers.push(await user(), await user());
  groupId = (
    await prisma.group.create({
      data: {
        username: prefix,
        name: "Fixture refund manager",
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
        salePrice: 20,
        upstreamCost: 10,
        maxMembers: 3,
        monthlyPassTemplateId: monthlyId,
        snapshotQuota: 100,
        snapshotValidityDays: 30,
      },
    })
  ).id;
  orderId = (
    await prisma.carpoolOrder.create({
      data: {
        ownerUserId: payers[0]!,
        packageTemplateId: templateId,
        monthlyPassTemplateId: monthlyId,
        packageName: prefix,
        salePrice: 20,
        upstreamCost: 10,
        maxMembers: 3,
        totalQuota: 100,
        validityDays: 30,
        state: "accepted",
      },
    })
  ).id;
  for (const userId of payers) {
    const member = await prisma.carpoolMember.create({
      data: { orderId, userId, state: "confirmed", payableAmount: 10, finalQuota: 50 },
    });
    reservations.push(
      (
        await prisma.balanceReservation.create({
          data: { userId, orderId, memberId: member.id, amount: 10, state: "captured" },
        })
      ).id,
    );
    await prisma.balanceAccount.create({ data: { userId, balance: 100, totalUsed: 20 } });
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.carpoolOrder.delete({ where: { id: orderId } });
  await prisma.carpoolPackageTemplate.delete({ where: { id: templateId } });
  await prisma.monthlyPassTemplate.delete({ where: { id: monthlyId } });
  env.security.iamAuthorizationMode = mode;
});
async function unchanged() {
  expect((await prisma.carpoolOrder.findUniqueOrThrow({ where: { id: orderId } })).state).toBe("accepted");
  expect(await prisma.carpoolOrderEvent.count({ where: { orderId } })).toBe(0);
  expect(await prisma.balanceTransaction.count({ where: { relatedId: orderId } })).toBe(0);
  for (const userId of payers)
    expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } })).balance)).toBe(100);
}
describe("carpool refund resource guards and billing rollback", () => {
  it("refunds each captured member and commits wallets, ledgers, reservations, state and event together", async () => {
    expect(await fail()).toMatchObject({ id: orderId, state: "failed", failureReason: "Fixture refund" });
    for (const userId of payers) {
      const account = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } });
      expect(Number(account.balance)).toBe(110);
      expect(Number(account.totalUsed)).toBe(10);
    }
    expect(await prisma.balanceTransaction.count({ where: { relatedId: orderId, type: "carpool_refund" } })).toBe(2);
    expect(await prisma.balanceReservation.count({ where: { orderId, state: "refunded" } })).toBe(2);
    expect(await prisma.carpoolOrderEvent.count({ where: { orderId, type: "failed" } })).toBe(1);
  });
  it.each(["order", "user", "account", "ledger"])(
    "rolls back everything when the %s resource is denied",
    async (kind) => {
      const resources: Record<string, string> = {
        order: platformCarpoolOrderArn(orderId),
        user: platformUserArn(payers[1]!),
        account: platformCarpoolRefundAccountArn(payers[1]!),
        ledger: platformCarpoolRefundLedgerArn(payers[1]!, "ledger").replace(/ledger$/, "*"),
      };
      await deny(resources[kind]!);
      await expect(fail()).rejects.toMatchObject({ statusCode: 403 });
      await unchanged();
      expect(await prisma.balanceReservation.count({ where: { orderId, state: "captured" } })).toBe(2);
    },
  );
  it("restores absent wallet rows when a later generated ledger is denied", async () => {
    await prisma.balanceAccount.delete({ where: { userId: payers[1]! } });
    await deny(platformCarpoolRefundLedgerArn(payers[1]!, "ledger").replace(/ledger$/, "*"));
    await expect(fail()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.balanceAccount.findUnique({ where: { userId: payers[1]! } })).toBeNull();
    expect(await prisma.balanceTransaction.count({ where: { relatedId: orderId } })).toBe(0);
    expect((await prisma.carpoolOrder.findUniqueOrThrow({ where: { id: orderId } })).state).toBe("accepted");
  });
  it.each(["reservation", "customer"])("refuses changed %s sources even with unchanged timestamps", async (which) => {
    const guard = await prepared();
    if (which === "reservation") {
      const source = await prisma.balanceReservation.findUniqueOrThrow({ where: { id: reservations[0]! } });
      await prisma.balanceReservation.update({
        where: { id: source.id },
        data: { amount: 99, updateTime: source.updateTime },
      });
    } else {
      const source = guard!.customers[0]!;
      await prisma.user.update({ where: { id: source.id }, data: { status: 0, updateTime: source.updateTime } });
    }
    await expect(
      CarpoolRepository.getInstance().withRefundTransaction(guard!, async () => ({ id: orderId })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rolls back all refunds when the final authorization recheck fails", async () => {
    const original = authority.prepare.bind(authority);
    vi.spyOn(authority, "prepare").mockImplementation(async (...args) => {
      const guard = await original(...args),
        check = guard!.users.recheck;
      guard!.users.recheck = async () => {
        await check();
        if (guard!.ledgers.length === 2) throw iamAccountDenied();
      };
      return guard;
    });
    await expect(fail()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rejects revoked authority and moved management group ownership after preparation", async () => {
    const guard = await prepared();
    await deny(platformCarpoolOrderArn(orderId));
    await expect(
      CarpoolRepository.getInstance().withRefundTransaction(guard!, async () => ({ id: orderId })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(fail()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("preserves refunds to disabled users and ignores departed members", async () => {
    await prisma.user.update({ where: { id: payers[0]! }, data: { status: 0 } });
    await prisma.carpoolMember.updateMany({ where: { orderId, userId: payers[1]! }, data: { state: "left" } });
    expect((await fail()).state).toBe("failed");
    expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: payers[0]! } })).balance)).toBe(
      110,
    );
    expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: payers[1]! } })).balance)).toBe(
      100,
    );
    expect(await prisma.balanceTransaction.count({ where: { relatedId: orderId } })).toBe(1);
  });
  it("uses current locked balances instead of overwriting independent billing changes", async () => {
    await prisma.balanceAccount.update({ where: { userId: payers[0]! }, data: { balance: 70, totalUsed: 50 } });
    await fail();
    const account = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: payers[0]! } });
    expect(Number(account.balance)).toBe(80);
    expect(Number(account.totalUsed)).toBe(40);
  });
  it("requires a native Allow and valid role sessions and request contexts", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
    await expect(fail()).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    const req = request();
    req.authContext!.roleSessionId = "missing-session";
    req.authContext!.assumedRoleId = "missing-role";
    await expect(service.fail(orderId, "Fixture", actor, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.fail(orderId, "Fixture", actor)).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("allows one concurrent refund, exactly one ledger per payer and one event", async () => {
    const results = await Promise.allSettled([fail(), fail()]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.balanceTransaction.count({ where: { relatedId: orderId } })).toBe(2);
    expect(await prisma.carpoolOrderEvent.count({ where: { orderId, type: "failed" } })).toBe(1);
    for (const userId of payers)
      expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId } })).balance)).toBe(110);
  });
});
