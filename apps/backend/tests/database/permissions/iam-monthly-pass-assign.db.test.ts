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
import { PlatformMonthlyPassAssignIamService } from "@/services/billing/platform-monthly-pass-assign-iam.service";
import { MonthlyPassRepository } from "@/store/billing/monthly-pass.repository";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import * as revisions from "@/store/users/iam-authorization-revision";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  authority = PlatformMonthlyPassAssignIamService.getInstance(),
  repository = MonthlyPassRepository.getInstance(),
  service = MonthlyPassService.getInstance();
let owner: string, actor: string, customer: string, groupId: string, templateId: string, passId: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    secure: true,
    ip: "192.0.2.40",
  }) as unknown as TypedRequest;
const prepared = () => authority.prepare(actor, request(), customer, templateId);
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
        permissions: [Permission.MONTHLY_PASS_ASSIGNMENT_WRITE],
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

const input = () => ({
  userId: customer,
  templateId,
  startAt: "2026-01-01",
  endAt: "2027-01-01",
  totalQuota: 100,
  quotaWindows: [{ quotaLimit: 20, quotaUnit: "amount" as const, quotaWindowHours: 24 }],
});
const raw = () => ({
  userId: customer,
  templateId,
  assignedBy: actor,
  startAt: new Date("2026-01-01"),
  endAt: new Date("2027-01-01"),
  status: 1,
  totalQuota: 100,
  usedQuota: 0,
  remainingQuota: 100,
});
describe("monthly pass assignment source and entry transaction", () => {
  it("creates a native assignment with its quota windows", async () => {
    const result = await service.assignUserPass(input(), actor, request());
    expect(result).toMatchObject({
      userId: customer,
      totalQuota: 100,
      remainingQuota: 100,
      usedQuota: 0,
      assignedBy: actor,
      templateName: expect.any(String),
    });
    expect(result.quotaWindows[0]?.quotaLimit).toBe(20);
  });
  it.each(["user", "template"])("requires the %s parent before creating anything", async (kind) => {
    await deny(
      "AssignUserPass",
      kind === "user" ? platformUserArn(customer) : platformTemplateArn("monthly-pass", templateId),
    );
    await expect(service.assignUserPass(input(), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.userMonthlyPass.count({ where: { userId: customer, templateId } })).toBe(1);
  });
  it("rolls back a new assignment and all its quota windows when the entry is denied", async () => {
    await deny("AssignUserPass", "acs:platform:*:platform:monthly-pass/" + customer + "/*");
    await expect(service.assignUserPass(input(), actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.userMonthlyPass.count({ where: { userId: customer, templateId } })).toBe(1);
    expect(
      await prisma.userMonthlyPassQuotaWindow.count({ where: { userMonthlyPass: { userId: customer, templateId } } }),
    ).toBe(1);
  });
  it("detects template quota-window drift without a parent timestamp change", async () => {
    await prisma.monthlyPassTemplateQuotaWindow.create({
      data: { monthlyPassTemplateId: templateId, quotaLimit: 25, quotaUnit: "amount", quotaWindowHours: 24 },
    });
    const source = await prepared();
    await prisma.monthlyPassTemplateQuotaWindow.updateMany({
      where: { monthlyPassTemplateId: templateId },
      data: { quotaLimit: 30 },
    });
    await expect(repository.createUserPass(raw(), [], source!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.userMonthlyPass.count({ where: { userId: customer, templateId } })).toBe(1);
  });
  it("rejects customer ownership drift even if its timestamp is unchanged", async () => {
    const source = await prepared(),
      user = await prisma.user.findUniqueOrThrow({ where: { id: customer } });
    await prisma.user.update({
      where: { id: customer },
      data: { accountOwnerId: owner, parentUserId: owner, userType: "ram_user", updateTime: user.updateTime },
    });
    await expect(repository.createUserPass(raw(), [], source!.guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("preserves the existing ability to preassign a pass to a disabled customer", async () => {
    await prisma.user.update({ where: { id: customer }, data: { status: 0 } });
    expect((await service.assignUserPass(input(), actor, request())).userId).toBe(customer);
  });
  it("rejects a disabled template or changed platform management eligibility", async () => {
    const source = await prepared();
    await prisma.monthlyPassTemplate.update({ where: { id: templateId }, data: { status: 0 } });
    await expect(repository.createUserPass(raw(), [], source!.guard)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.monthlyPassTemplate.update({ where: { id: templateId }, data: { status: 1 } });
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(prepared()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back if the final identity or policy check fails", async () => {
    const source = await prepared(),
      recheck = source!.guard.users.recheck;
    let calls = 0;
    source!.guard.users.recheck = async () => {
      await recheck();
      if (++calls === 2) throw iamAccountDenied();
    };
    await expect(
      repository.createUserPass(raw(), [{ quotaLimit: 50, quotaUnit: "amount", quotaWindowHours: 12 }], source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.userMonthlyPass.count({ where: { userId: customer, templateId } })).toBe(1);
  });
  it("rejects source policy revocation after preparation and forged record ownership", async () => {
    const source = await prepared();
    await expect(repository.createUserPass({ ...raw(), userId: owner }, [], source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    await deny("AssignUserPass", platformUserArn(customer));
    await expect(repository.createUserPass(raw(), [], source!.guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back when the persistent authorization revision changes", async () => {
    const source = await prepared();
    let calls = 0;
    vi.spyOn(revisions, "readIamAuthorizationRevision").mockImplementation(async () =>
      ++calls === 1 ? "before" : "after",
    );
    await expect(repository.createUserPass(raw(), [], source!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.userMonthlyPass.count({ where: { userId: customer, templateId } })).toBe(1);
  });
});
