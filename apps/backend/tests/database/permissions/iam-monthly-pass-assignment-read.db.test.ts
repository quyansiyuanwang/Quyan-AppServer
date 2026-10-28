import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformMonthlyPassArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { PlatformMonthlyPassAssignmentReadIamService } from "@/services/billing/platform-monthly-pass-assignment-read-iam.service";
import { PlatformMonthlyPassAssignmentReadRepository } from "@/store/billing/platform-monthly-pass-assignment-read.repository";
import { platformMonthlyPassUsageArn } from "@/iam/resources/platform-monthly-pass-resources";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  service = MonthlyPassService.getInstance();
let owner: string,
  actor: string,
  customer: string,
  groupId: string,
  templateId: string,
  passId: string,
  otherId: string,
  usageId: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    secure: true,
    ip: "192.0.2.40",
  }) as unknown as TypedRequest;

async function deny(operation: string, resource = platformMonthlyPassArn(customer, passId)) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:monthly_pass:" + operation, Resource: resource },
  });
  const p = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "monthly-assignment-deny-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: p.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "monthly-assignment-" + randomUUID(),
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
  customer = await user();
  groupId = (
    await prisma.group.create({
      data: {
        username: "monthly-assignment-global-" + randomUUID(),
        name: "fixture assignment manager",
        accountOwnerId: null,
        permissions: [Permission.MONTHLY_PASS_ASSIGNMENT_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  templateId = (
    await prisma.monthlyPassTemplate.create({
      data: {
        name: "fixture-template-" + randomUUID(),
        defaultQuota: 100,
        description: "fixture template description",
        allowedModels: '["fixture-model"]',
      },
    })
  ).id;
  passId = (
    await prisma.userMonthlyPass.create({
      data: {
        userId: customer,
        templateId,
        startAt: new Date("2026-01-01"),
        endAt: new Date("2027-01-01"),
        totalQuota: 100,
        usedQuota: 10,
        remainingQuota: 90,
        quotaWindows: { create: { quotaLimit: 20, quotaUnit: "amount", quotaWindowHours: 24 } },
      },
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  await prisma.monthlyPassTemplate.deleteMany({ where: { id: templateId } });
});

beforeEach(async () => {
  const first = await prisma.userMonthlyPass.findUniqueOrThrow({ where: { id: passId } });
  await prisma.userMonthlyPass.update({
    where: { id: passId },
    data: { createTime: new Date("2026-01-02"), endAt: new Date("2027-01-01") },
  });
  otherId = (
    await prisma.userMonthlyPass.create({
      data: {
        userId: customer,
        templateId,
        startAt: first.startAt,
        endAt: new Date("2027-02-01"),
        totalQuota: 50,
        remainingQuota: 50,
        createTime: new Date("2026-01-03"),
      },
    })
  ).id;
  usageId = (
    await prisma.monthlyPassUsage.create({
      data: {
        userId: customer,
        userMonthlyPassId: passId,
        coveredAmount: 10,
        totalRequestCost: 10,
        remainingRequestCost: 0,
      },
    })
  ).id;
});
const read = (page = 1, pageSize = 20, filters = { userId: customer }) =>
  PlatformMonthlyPassAssignmentReadIamService.getInstance().list(
    request(),
    { page, pageSize },
    filters,
    (view) => view,
    async () => {
      throw new Error("legacy must not run");
    },
  );
describe("persisted assignment collection projection", () => {
  it("preserves business ordering and counts only the authorized primary resources", async () => {
    expect(await read(1, 1)).toMatchObject({ total: 2, records: [{ record: { id: passId }, quotaUsage: true }] });
    expect(await read(2, 1)).toMatchObject({ records: [{ record: { id: otherId } }] });
    await deny("ListUserPasses", platformMonthlyPassArn(customer, passId));
    expect(await read(1, 1)).toMatchObject({ total: 1, records: [{ record: { id: otherId } }] });
  });
  it("shows complete native quota-window usage and exact stored balances", async () => {
    expect(await service.listUserPasses(1, 1, customer, templateId, undefined, request())).toMatchObject({
      total: 2,
      records: [
        {
          id: passId,
          usedQuota: 10,
          remainingQuota: 90,
          quotaWindows: [{ quotaLimit: 20, usedQuota: 10, remainingQuota: 10 }],
        },
      ],
    });
  });
  it("withholds quota-window counters when a contributing usage record is denied", async () => {
    await deny("ListUserPasses", platformMonthlyPassUsageArn(customer, passId, usageId));
    const result = await service.listUserPasses(1, 1, customer, templateId, undefined, request());
    expect(result.records[0]?.usedQuota).toBe(10);
    expect(result.records[0]?.quotaWindows[0]?.usedQuota).toBeUndefined();
    expect(result.records[0]?.quotaWindows[0]?.remainingQuota).toBeUndefined();
  });
  it("withholds username and template content while retaining assignment quotas", async () => {
    await deny("ListUserPasses", platformUserArn(customer));
    await deny("ListUserPasses", platformTemplateArn("monthly-pass", templateId));
    const result = await service.listUserPasses(1, 1, customer, templateId, undefined, request());
    expect(result.records[0]).toMatchObject({ id: passId, templateName: "", remainingQuota: 90 });
    expect(result.records[0]?.username).toBeUndefined();
    expect(result.records[0]?.templateDescription).toBeUndefined();
    expect(result.records[0]?.allowedModels).toBeUndefined();
  });
  it("never hydrates content for a denied primary record", async () => {
    await deny("ListUserPasses", platformMonthlyPassArn(customer, passId));
    const hydrate = vi.spyOn(PlatformMonthlyPassAssignmentReadRepository.getInstance(), "hydrate");
    await read();
    expect(hydrate.mock.calls[0]![1].map((row) => row.target.id)).toEqual([otherId]);
  });
  it.each(["assignment", "template", "quota-window", "usage"])(
    "rejects %s content drift even if parent timestamps remain unchanged",
    async (kind) => {
      const repo = PlatformMonthlyPassAssignmentReadRepository.getInstance(),
        hydrate = repo.hydrate.bind(repo);
      vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
        const result = await hydrate(...args);
        if (kind === "assignment") {
          const row = await prisma.userMonthlyPass.findUniqueOrThrow({ where: { id: passId } });
          await prisma.userMonthlyPass.update({
            where: { id: passId },
            data: { note: "changed", updateTime: row.updateTime },
          });
        } else if (kind === "template") {
          const row = await prisma.monthlyPassTemplate.findUniqueOrThrow({ where: { id: templateId } });
          await prisma.monthlyPassTemplate.update({
            where: { id: templateId },
            data: { description: "changed", updateTime: row.updateTime },
          });
        } else if (kind === "quota-window")
          await prisma.userMonthlyPassQuotaWindow.updateMany({
            where: { userMonthlyPassId: passId },
            data: { quotaLimit: 40 },
          });
        else {
          const row = await prisma.monthlyPassUsage.findUniqueOrThrow({ where: { id: usageId } });
          await prisma.monthlyPassUsage.update({
            where: { id: usageId },
            data: { coveredAmount: 20, updateTime: row.updateTime },
          });
        }
        return result;
      });
      await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("rejects policy revocation during hydration", async () => {
    const repo = PlatformMonthlyPassAssignmentReadRepository.getInstance(),
      hydrate = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const result = await hydrate(...args);
      await deny("ListUserPasses", platformMonthlyPassUsageArn(customer, passId, usageId));
      return result;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects cross-owner usage references and unqualified management groups", async () => {
    await prisma.monthlyPassUsage.update({ where: { id: usageId }, data: { userId: owner } });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.monthlyPassUsage.update({ where: { id: usageId }, data: { userId: customer } });
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies exact user, template and status filters before authorization", async () => {
    expect((await read(1, 20, { userId: owner })).total).toBe(0);
    expect((await read(1, 20, { userId: customer.toUpperCase() })).total).toBe(0);
    await prisma.userMonthlyPass.update({ where: { id: otherId }, data: { status: 0 } });
    expect((await read(1, 20, { userId: customer, status: 1 } as any)).total).toBe(1);
  });
});
