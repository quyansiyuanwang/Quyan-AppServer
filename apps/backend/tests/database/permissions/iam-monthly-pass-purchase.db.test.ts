import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import { ConfigService } from "@/services/system/config.service";
import { MonthlyPassPurchaseIamService } from "@/services/billing/monthly-pass-purchase-iam.service";
import { MonthlyPassRepository } from "@/store/billing/monthly-pass.repository";
import { bindMonthlyPassPurchaseQuote } from "@/store/billing/monthly-pass-purchase";
import { monthlyPassTemplateArn } from "@/iam/resources/monthly-pass-resources";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = MonthlyPassService.getInstance(),
  authority = MonthlyPassPurchaseIamService.getInstance(),
  repository = MonthlyPassRepository.getInstance(),
  config = ConfigService.getInstance();
let owner: string, actor: string, templateId: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    ip: "192.0.2.42",
    secure: true,
  }) as unknown as TypedRequest;
const claim = () => service.claimPublishedTemplate({ templateId }, actor, request());
const raw = () => ({
  userId: actor,
  templateId,
  startAt: new Date("2026-10-15"),
  endAt: new Date("2026-11-15"),
  totalQuota: 100,
  dailyQuota: null,
  quotaUnit: "amount",
  quotaWindowHours: null,
  usedQuota: 0,
  remainingQuota: 100,
  assignedBy: actor,
  note: "self-claimed",
  status: 1,
});
const windows = () => [{ quotaLimit: 20, quotaUnit: "amount" as const, quotaWindowHours: 24 }];
const quote = () => ({ userId: actor, purchaseAmount: 1, templateName: "fixture-template-" + templateId, templateId });
const prepared = () => authority.prepare(actor, request(), templateId);
async function deny(resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:monthly_pass:ClaimPublishedTemplate", Resource: resource },
  });
  const p = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "month-purchase-deny-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      policyId: p.id,
      principalType: "user",
      principalId: actor,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  vi.spyOn(config, "getRechargeRatio").mockResolvedValue(1);
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "month-purchase-" + randomUUID(),
          password: "fixture-only",
          permissionAdds: [],
          permissionRemoves: [],
          accountOwnerId,
          parentUserId: accountOwnerId,
          userType: accountOwnerId ? "ram_user" : "root",
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  await prisma.balanceAccount.create({ data: { userId: actor, balance: 100 } });
  const template = await prisma.monthlyPassTemplate.create({
    data: {
      name: "fixture-monthly-purchase-" + randomUUID(),
      defaultQuota: 100,
      discountedPrice: 1,
      publishStatus: "published",
      allowBalanceRedemption: true,
      purchaseLimitPerUser: 1,
      purchaseLimitWindowDays: 30,
      quotaWindows: { create: { quotaLimit: 20, quotaUnit: "amount", quotaWindowHours: 24 } },
    },
  });
  templateId = template.id;
  await prisma.monthlyPassTemplate.update({
    where: { id: templateId },
    data: { name: "fixture-template-" + templateId },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.monthlyPassTemplate.deleteMany({ where: { id: templateId } });
});
async function unchanged() {
  expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: actor } })).balance)).toBe(100);
  expect(await prisma.balanceTransaction.count({ where: { userId: actor } })).toBe(0);
  expect(await prisma.userMonthlyPass.count({ where: { userId: actor } })).toBe(0);
}
async function bound() {
  const source = await prepared(),
    data = raw(),
    quota = windows(),
    charge = quote();
  bindMonthlyPassPurchaseQuote(source!.guard, data, quota, charge, async () => {});
  return { guard: source!.guard, data, quota, charge };
}
describe("monthly pass authorized purchases", () => {
  it("charges only the current quote and creates the authorized pass and windows", async () => {
    const result = await claim();
    expect(result).toMatchObject({
      purchaseAmount: 1,
      userPass: { userId: actor, totalQuota: 100, remainingQuota: 100 },
    });
    expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: actor } })).balance)).toBe(99);
    expect(await prisma.balanceTransaction.count({ where: { userId: actor } })).toBe(1);
    expect(result.userPass.quotaWindows[0]?.quotaLimit).toBe(20);
  });
  it.each(["user", "template"])("denies the %s parent without charging", async (kind) => {
    await deny(
      kind === "user" ? "acs:quyan:*:" + owner + ":user/" + actor : monthlyPassTemplateArn(owner, actor, templateId),
    );
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rolls back the debit, ledger, pass and windows when the generated resource is denied", async () => {
    await deny("acs:monthly-pass:*:" + owner + ":assignment/" + actor + "/*");
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
    expect(await prisma.userMonthlyPassQuotaWindow.count({ where: { userMonthlyPass: { userId: actor } } })).toBe(0);
  });
  it("rejects template pricing changed with its timestamp preserved", async () => {
    const source = await bound();
    await prisma.monthlyPassTemplate.update({
      where: { id: templateId },
      data: { discountedPrice: 2, updateTime: source.guard.template.updateTime },
    });
    await expect(
      repository.purchaseUserPass(source.data, source.quota, source.charge, source.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rejects changed template quota windows independently of parent timestamps", async () => {
    const source = await bound();
    await prisma.monthlyPassTemplateQuotaWindow.updateMany({
      where: { monthlyPassTemplateId: templateId },
      data: { quotaLimit: 40 },
    });
    await expect(
      repository.purchaseUserPass(source.data, source.quota, source.charge, source.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rejects unpublished templates prepared before the status change", async () => {
    const source = await bound();
    await prisma.monthlyPassTemplate.update({ where: { id: templateId }, data: { publishStatus: "draft" } });
    await expect(
      repository.purchaseUserPass(source.data, source.quota, source.charge, source.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rejects tampered charges, entitlement quota and target identities", async () => {
    const source = await bound();
    for (const data of [
      { ...source.data, totalQuota: 1000, remainingQuota: 1000 },
      { ...source.data, userId: owner },
      { ...source.data, id: "client-id" },
    ])
      await expect(repository.purchaseUserPass(data, source.quota, source.charge, source.guard)).rejects.toMatchObject({
        statusCode: 403,
      });
    await expect(
      repository.purchaseUserPass(source.data, source.quota, { ...source.charge, purchaseAmount: 0 }, source.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rechecks quote conversion after the debit and rolls back stale pricing", async () => {
    vi.spyOn(config, "getRechargeRatio").mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValue(2);
    await expect(claim()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rolls back all writes on final identity revocation", async () => {
    const source = await bound(),
      recheck = source.guard.users.recheck;
    let calls = 0;
    source.guard.users.recheck = async () => {
      await recheck();
      if (++calls === 2) throw iamAccountDenied();
    };
    await expect(
      repository.purchaseUserPass(source.data, source.quota, source.charge, source.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("enforces the locked template purchase limit even if a trusted caller omits its limit hint", async () => {
    await claim();
    const source = await bound();
    await expect(
      repository.purchaseUserPass(source.data, source.quota, source.charge, source.guard),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: actor } })).balance)).toBe(99);
    expect(await prisma.userMonthlyPass.count({ where: { userId: actor } })).toBe(1);
  });
  it("serializes concurrent free claims without requiring a balance row lock", async () => {
    await prisma.monthlyPassTemplate.update({ where: { id: templateId }, data: { discountedPrice: 0 } });
    await prisma.balanceAccount.delete({ where: { userId: actor } });
    const results = await Promise.allSettled([claim(), claim()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.userMonthlyPass.count({ where: { userId: actor } })).toBe(1);
    expect(await prisma.balanceAccount.findUnique({ where: { userId: actor } })).toBeNull();
    expect(await prisma.balanceTransaction.count({ where: { userId: actor } })).toBe(0);
  });
  it("preserves insufficient-balance refusal", async () => {
    await prisma.balanceAccount.update({ where: { userId: actor }, data: { balance: 0 } });
    await expect(claim()).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.userMonthlyPass.count({ where: { userId: actor } })).toBe(0);
    expect(await prisma.balanceTransaction.count({ where: { userId: actor } })).toBe(0);
  });
});
