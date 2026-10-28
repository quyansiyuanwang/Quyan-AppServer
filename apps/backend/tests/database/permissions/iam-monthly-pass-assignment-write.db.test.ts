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
import { PlatformMonthlyPassAssignmentWriteIamService } from "@/services/billing/platform-monthly-pass-assignment-write-iam.service";
import { MonthlyPassRepository } from "@/store/billing/monthly-pass.repository";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import * as revisions from "@/store/users/iam-authorization-revision";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  authority = PlatformMonthlyPassAssignmentWriteIamService.getInstance(),
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
const prepared = () => authority.prepare("UpdateUserPass", actor, request(), passId);
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
describe("monthly pass assignment resource mutation and rollback", () => {
  it("updates quotas and windows and deletes through the native business methods", async () => {
    const result = await service.updateUserPass(
      passId,
      {
        totalQuota: 120,
        quotaWindows: [{ quotaLimit: 30, quotaUnit: "amount", quotaWindowHours: 24 }],
        note: "edited",
      },
      actor,
      request(),
    );
    expect(result).toMatchObject({
      id: passId,
      totalQuota: 120,
      usedQuota: 10,
      remainingQuota: 110,
      note: "edited",
      templateName: expect.any(String),
    });
    expect(result.quotaWindows[0]?.quotaLimit).toBe(30);
    await service.deleteUserPass(passId, actor, request());
    expect((await repository.findUserPassById(passId))?.status).toBe(-1);
  });
  it("requires DeleteUserPass for deletion through UpdateUserPass", async () => {
    await deny("DeleteUserPass");
    await expect(service.updateUserPass(passId, { status: -1 }, actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.deleteUserPass(passId, actor, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await repository.findUserPassById(passId))?.status).toBe(1);
  });
  it("keeps resource-scoped UpdateUserPass unable to modify other assignments", async () => {
    await deny("UpdateUserPass");
    await expect(service.updateUserPass(passId, { note: "denied" }, actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await repository.findUserPassById(passId))?.note).toBeNull();
  });
  it("withholds related user and template data when only the assignment is allowed", async () => {
    await deny("UpdateUserPass", platformUserArn(customer));
    await deny("UpdateUserPass", platformTemplateArn("monthly-pass", templateId));
    const result = await service.updateUserPass(passId, { note: "allowed assignment" }, actor, request());
    expect(result.templateName).toBe("");
    expect(result.username).toBeUndefined();
    expect(result.templateDescription).toBeUndefined();
    expect(result.allowedModels).toBeUndefined();
    expect(result.note).toBe("allowed assignment");
  });
  it("rejects consumed quota drift without overwriting a concurrent balance", async () => {
    const source = await prepared(),
      row = await prisma.userMonthlyPass.findUniqueOrThrow({ where: { id: passId } });
    await prisma.userMonthlyPass.update({
      where: { id: passId },
      data: { usedQuota: 20, remainingQuota: 80, updateTime: row.updateTime },
    });
    await expect(
      repository.updateUserPass(passId, { note: "stale", remainingQuota: 90 }, undefined, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await repository.findUserPassById(passId))?.remainingQuota.toNumber()).toBe(80);
  });
  it("rejects quota-window drift with an unchanged parent timestamp", async () => {
    const source = await prepared();
    await prisma.userMonthlyPassQuotaWindow.updateMany({
      where: { userMonthlyPassId: passId },
      data: { quotaLimit: 40 },
    });
    await expect(repository.updateUserPass(passId, { note: "stale" }, undefined, source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await repository.findUserPassById(passId))?.note).toBeNull();
  });
  it("rolls back the assignment and replaced quota windows on a final decision failure", async () => {
    const source = await prepared(),
      recheck = source!.guard.users.recheck;
    let calls = 0;
    source!.guard.users.recheck = async () => {
      await recheck();
      if (++calls === 2) throw iamAccountDenied();
    };
    await expect(
      repository.updateUserPass(
        passId,
        { note: "rollback" },
        [{ quotaLimit: 80, quotaUnit: "amount", quotaWindowHours: 12 }],
        source!.guard,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const row = await repository.findUserPassById(passId);
    expect(row?.note).toBeNull();
    expect(row?.quotaWindows[0]?.quotaLimit.toNumber()).toBe(20);
  });
  it("rejects revocation after guard preparation", async () => {
    const source = await prepared();
    await deny("UpdateUserPass");
    await expect(
      repository.updateUserPass(passId, { note: "revoked" }, undefined, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await repository.findUserPassById(passId))?.note).toBeNull();
  });
  it("preserves global management membership as a non-delegable ceiling", async () => {
    const source = await prepared();
    await prisma.$executeRaw`UPDATE \`groups\` SET permissions='[]' WHERE id=${groupId}`;
    await expect(
      repository.updateUserPass(passId, { note: "revoked" }, undefined, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.MONTHLY_PASS_ASSIGNMENT_WRITE], accountOwnerId: owner },
    });
    await expect(prepared()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a target identity rewrite or authority reuse across mutation methods", async () => {
    const source = await prepared();
    await expect(repository.updateUserPass(passId, { userId: owner }, undefined, source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(repository.softDeleteUserPass(passId, source!.guard)).rejects.toMatchObject({ statusCode: 403 });
    const deletion = await authority.prepare("DeleteUserPass", actor, request(), passId);
    await expect(
      repository.updateUserPass(
        passId,
        { status: -1 },
        [{ quotaLimit: 60, quotaUnit: "amount", quotaWindowHours: 12 }],
        deletion!.guard,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back if the persistent authorization revision changes", async () => {
    const source = await prepared();
    let calls = 0;
    vi.spyOn(revisions, "readIamAuthorizationRevision").mockImplementation(async () =>
      ++calls === 1 ? "fixture-before" : "fixture-after",
    );
    await expect(
      repository.updateUserPass(passId, { note: "rollback" }, undefined, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await repository.findUserPassById(passId))?.note).toBeNull();
  });
});
