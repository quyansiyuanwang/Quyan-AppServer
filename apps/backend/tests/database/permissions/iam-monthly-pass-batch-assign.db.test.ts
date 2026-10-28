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
import { UserRepository } from "@/store/users/user.repository";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
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
const prepared = () => authority.prepare(actor, request(), customer, templateId, "AssignUserPassBatch");
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

const batchInput = () => ({
  userIds: [customer],
  templateId,
  startAt: "2026-01-01",
  endAt: "2026-02-01",
  totalQuota: 20,
  assignmentMode: "extend_existing" as const,
});
const extension = async () => authority.prepareBatchExtension((await prepared())!.guard);
const nextValues = () => ({ endAt: new Date("2027-02-01"), totalQuota: 120, remainingQuota: 110 });
describe("batch monthly pass transactions", () => {
  it("extends every authorized target without resetting consumed quota", async () => {
    const result = await service.assignUserPassBatch(batchInput(), actor, request());
    expect(result).toMatchObject({ totalTargets: 1, extendedCount: 1, failedCount: 0 });
    const current = await prisma.userMonthlyPass.findUniqueOrThrow({ where: { id: passId } });
    expect(Number(current.totalQuota)).toBe(120);
    expect(Number(current.remainingQuota)).toBe(110);
    expect(Number(current.usedQuota)).toBe(10);
    expect(current.endAt).toEqual(new Date("2027-02-01"));
  });
  it("creates a new pass with the batch Action rather than the single Action", async () => {
    await deny("AssignUserPass", "*");
    const result = await service.assignUserPassBatch(
      { ...batchInput(), assignmentMode: "create_new" },
      actor,
      request(),
    );
    expect(result).toMatchObject({ createdCount: 1, failedCount: 0 });
  });
  it("returns partial results without exposing denied customer names", async () => {
    const other = (
      await prisma.user.create({
        data: {
          username: "batch-allowed-" + randomUUID(),
          password: "fixture-only",
          permissionAdds: [],
          permissionRemoves: [],
        },
      })
    ).id;
    const name = (await prisma.user.findUniqueOrThrow({ where: { id: customer }, select: { username: true } }))
      .username;
    await deny("AssignUserPassBatch", platformUserArn(customer));
    const result = await service.assignUserPassBatch(
      { ...batchInput(), userIds: [customer, other], assignmentMode: "create_new" },
      actor,
      request(),
    );
    expect(result).toMatchObject({ totalTargets: 2, createdCount: 1, failedCount: 1 });
    expect(result.records.find((item) => item.userId === customer)).toMatchObject({
      result: "failed",
      username: undefined,
    });
    expect(JSON.stringify(result)).not.toContain(name);
    expect(await prisma.userMonthlyPass.count({ where: { userId: customer, templateId } })).toBe(1);
  });
  it("does not extend a denied assignment or fall back to creation", async () => {
    await deny("AssignUserPassBatch");
    const result = await service.assignUserPassBatch(batchInput(), actor, request());
    expect(result).toMatchObject({ extendedCount: 0, failedCount: 1 });
    const row = await prisma.userMonthlyPass.findUniqueOrThrow({ where: { id: passId } });
    expect(Number(row.remainingQuota)).toBe(90);
    expect(await prisma.userMonthlyPass.count({ where: { userId: customer, templateId } })).toBe(1);
  });
  it("rolls back created resources and windows if the generated ARN is denied", async () => {
    await deny("AssignUserPassBatch", "acs:platform:*:platform:monthly-pass/" + customer + "/*");
    const result = await service.assignUserPassBatch(
      {
        ...batchInput(),
        assignmentMode: "create_new",
        quotaWindows: [{ quotaLimit: 10, quotaUnit: "amount", quotaWindowHours: 24 }],
      },
      actor,
      request(),
    );
    expect(result).toMatchObject({ createdCount: 0, failedCount: 1 });
    expect(await prisma.userMonthlyPass.count({ where: { userId: customer, templateId } })).toBe(1);
    expect(await prisma.userMonthlyPassQuotaWindow.count({ where: { userMonthlyPassId: passId } })).toBe(1);
  });
  it("detects concurrent consumption even without changing the parent timestamp", async () => {
    const source = await extension();
    await prisma.userMonthlyPass.update({
      where: { id: passId },
      data: { usedQuota: 15, remainingQuota: 85, updateTime: source!.record.updateTime },
    });
    await expect(repository.updateUserPass(passId, nextValues(), [], source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    const row = await prisma.userMonthlyPass.findUniqueOrThrow({ where: { id: passId } });
    expect(Number(row.remainingQuota)).toBe(85);
    expect(Number(row.totalQuota)).toBe(100);
  });
  it("rejects template defaults changed without updating the timestamp", async () => {
    const source = await extension();
    await prisma.monthlyPassTemplate.update({
      where: { id: templateId },
      data: { defaultQuota: 200, updateTime: source!.guard.batchSources!.template.updateTime },
    });
    await expect(repository.updateUserPass(passId, nextValues(), [], source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects a newly created latest pass rather than extending an older one", async () => {
    const source = await extension();
    await prisma.userMonthlyPass.create({ data: { ...raw(), endAt: new Date("2028-01-01") } });
    await expect(repository.updateUserPass(passId, nextValues(), [], source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects changed customer account ownership and forged deletion", async () => {
    const source = await extension();
    await expect(repository.updateUserPass(passId, { status: -1 }, [], source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.user.update({
      where: { id: customer },
      data: { accountOwnerId: owner, updateTime: source!.guard.batchSources!.customer.updateTime },
    });
    await expect(repository.updateUserPass(passId, nextValues(), [], source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rolls back an extension and replaced windows on final revocation", async () => {
    const source = await extension(),
      recheck = source!.guard.users.recheck;
    let calls = 0;
    source!.guard.users.recheck = async () => {
      await recheck();
      if (++calls === 2) throw iamAccountDenied();
    };
    await expect(
      repository.updateUserPass(
        passId,
        nextValues(),
        [{ quotaLimit: 30, quotaUnit: "amount", quotaWindowHours: 12 }],
        source!.guard,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const row = await prisma.userMonthlyPass.findUniqueOrThrow({
      where: { id: passId },
      include: { quotaWindows: true },
    });
    expect(Number(row.totalQuota)).toBe(100);
    expect(row.quotaWindows[0]?.quotaLimit.toNumber()).toBe(20);
  });
  it("rechecks policy revocation at commit", async () => {
    const source = await extension();
    await deny("AssignUserPassBatch", platformUserArn(customer));
    await expect(repository.updateUserPass(passId, nextValues(), [], source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("requires deployment management eligibility before discovering any targets", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(service.assignUserPassBatch(batchInput(), actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("filters unauthorized discovered identities without loading credentials or usernames", async () => {
    await prisma.user.update({ where: { id: customer }, data: { groupId } });
    const name = (await prisma.user.findUniqueOrThrow({ where: { id: customer }, select: { username: true } }))
      .username;
    await deny("AssignUserPassBatch", platformUserArn(customer));
    const users = UserRepository.getInstance(),
      names = vi.spyOn(users, "findUsernamesByIds"),
      full = vi.spyOn(users, "listNonDeletedByGroupLevelGtePaginated");
    const result = await service.assignUserPassBatch(
      { ...batchInput(), userIds: undefined, targetFilter: { keyword: name, includeAllVisible: true } },
      actor,
      request(),
    );
    expect(result).toMatchObject({ totalTargets: 0, records: [] });
    expect(names).not.toHaveBeenCalled();
    expect(full).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(customer);
  });
  it("rechecks a changed source IP without requiring a policy edit", async () => {
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:monthly_pass:AssignUserPassBatch",
        Resource: platformMonthlyPassArn(customer, passId),
        Condition: { NotIpAddress: { "acs:SourceIp": "192.0.2.40" } },
      },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "batch-ip-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        policyId: policy.id,
        principalType: "user",
        principalId: actor,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
    const req = request(),
      source = await authority.prepare(actor, req, customer, templateId, "AssignUserPassBatch");
    const ext = await authority.prepareBatchExtension(source!.guard);
    Object.defineProperty(req, "ip", { value: "198.51.100.5", configurable: true });
    await expect(repository.updateUserPass(passId, nextValues(), [], ext!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("requires the shared template for every target", async () => {
    await deny("AssignUserPassBatch", platformTemplateArn("monthly-pass", templateId));
    const result = await service.assignUserPassBatch(batchInput(), actor, request());
    expect(result).toMatchObject({ extendedCount: 0, failedCount: 1 });
    expect(await prisma.userMonthlyPass.count({ where: { userId: customer, templateId } })).toBe(1);
  });
});
