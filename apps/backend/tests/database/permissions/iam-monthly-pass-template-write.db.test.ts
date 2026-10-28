import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformMonthlyPassTemplateWriteIamService } from "@/services/billing/platform-monthly-pass-template-write-iam.service";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import { MonthlyPassRepository } from "@/store/billing/monthly-pass.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import * as revisions from "@/store/users/iam-authorization-revision";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
const authority = PlatformMonthlyPassTemplateWriteIamService.getInstance(),
  repository = MonthlyPassRepository.getInstance(),
  service = MonthlyPassService.getInstance();
let owner: string, actor: string, groupId: string, template: string, prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "client:Fake" },
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
async function deny(operation: string, resource = platformTemplateArn("monthly-pass", template)) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:monthly_pass:" + operation, Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "monthly-deny-" + randomUUID(),
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
const prepared = () => authority.prepare("UpdateTemplate", actor, request(), template);
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "monthly-write-" + randomUUID();
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: "monthly-write-" + randomUUID(),
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
        name: "Fixture monthly manager",
        accountOwnerId: null,
        permissions: [Permission.MONTHLY_PASS_TEMPLATE_WRITE],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  template = (
    await prisma.monthlyPassTemplate.create({
      data: {
        name: prefix,
        defaultQuota: 100,
        quotaWindows: { create: [{ quotaLimit: 10, quotaUnit: "amount", quotaWindowHours: 24 }] },
      },
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.monthlyPassTemplate.deleteMany({ where: { name: { startsWith: prefix } } });
  env.security.iamAuthorizationMode = originalMode;
});
describe("monthly pass template resource authorization and transaction", () => {
  it("updates quota windows, publishes, unpublishes and deletes through native business methods", async () => {
    expect(
      (
        await service.updateTemplate(
          template,
          { description: "edited", quotaWindows: [{ quotaLimit: 20, quotaUnit: "amount", quotaWindowHours: 24 }] },
          actor,
          request(),
        )
      ).quotaWindows?.[0]?.quotaLimit,
    ).toBe(20);
    expect((await service.publishTemplate(template, actor, request())).publishStatus).toBe("published");
    expect((await service.unpublishTemplate(template, actor, request())).publishStatus).toBe("draft");
    await service.deleteTemplate(template, actor, request());
    expect((await prisma.monthlyPassTemplate.findUnique({ where: { id: template } }))?.status).toBe(-1);
  });
  it("creates a normalized template with quota windows under control and entry authority", async () => {
    const row = await service.createTemplate(
      {
        name: prefix + "-created",
        defaultQuota: 100,
        quotaWindows: [{ quotaLimit: 30, quotaUnit: "amount", quotaWindowHours: 24 }],
      },
      actor,
      request(),
    );
    expect(row).toMatchObject({ status: 1, publishStatus: "draft" });
    expect(row.quotaWindows?.[0]?.quotaLimit).toBe(30);
  });
  it("requires DeleteTemplate to delete through update and cannot reuse publication authority", async () => {
    await deny("DeleteTemplate");
    await expect(service.updateTemplate(template, { status: -1 }, actor, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    const source = await authority.prepare("PublishTemplate", actor, request(), template);
    await expect(
      repository.updateTemplate(
        template,
        { status: -1, publishStatus: "published", publishedAt: new Date() },
        undefined,
        source!.guard,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      repository.updateTemplate(
        template,
        { publishStatus: "published", publishedAt: new Date() },
        [{ quotaLimit: 100, quotaUnit: "amount", quotaWindowHours: 24 }],
        source!.guard,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.monthlyPassTemplate.findUnique({ where: { id: template } }))?.status).toBe(1);
  });
  it("rolls back newly created rows and quota windows when entry admission fails", async () => {
    await deny("CreateTemplate", "acs:platform:*:platform:monthly-pass-template/*");
    await expect(
      service.createTemplate(
        {
          name: prefix + "-denied",
          defaultQuota: 100,
          quotaWindows: [{ quotaLimit: 30, quotaUnit: "amount", quotaWindowHours: 24 }],
        },
        actor,
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.monthlyPassTemplate.count({ where: { name: prefix + "-denied" } })).toBe(0);
  });
  it("detects quota-window revision drift even without a template timestamp change", async () => {
    const source = await prepared();
    await prisma.monthlyPassTemplateQuotaWindow.updateMany({
      where: { monthlyPassTemplateId: template },
      data: { quotaLimit: 33 },
    });
    await expect(
      repository.updateTemplate(template, { description: "stale" }, undefined, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await repository.findTemplateById(template))?.description).toBeNull();
  });
  it("rejects policy revocation after preparation", async () => {
    const source = await prepared();
    await deny("UpdateTemplate");
    await expect(
      repository.updateTemplate(template, { description: "revoked" }, undefined, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await repository.findTemplateById(template))?.description).toBeNull();
  });
  it("retains the platform management ceiling after group eligibility changes", async () => {
    const source = await prepared();
    await prisma.$executeRaw`UPDATE \`groups\` SET permissions='[]' WHERE id=${groupId}`;
    await expect(
      repository.updateTemplate(template, { description: "revoked" }, undefined, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.MONTHLY_PASS_TEMPLATE_WRITE], accountOwnerId: owner },
    });
    await expect(prepared()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back template and quota changes if the final authorization fails", async () => {
    const source = await prepared(),
      entry = source!.guard.recheckEntry;
    let checks = 0;
    source!.guard.recheckEntry = async (id) => {
      await entry(id);
      if (++checks === 2) throw iamAccountDenied();
    };
    await expect(
      repository.updateTemplate(
        template,
        { description: "rollback" },
        [{ quotaLimit: 99, quotaUnit: "amount", quotaWindowHours: 24 }],
        source!.guard,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const row = await repository.findTemplateById(template);
    expect(row?.description).toBeNull();
    expect(Number(row?.quotaWindows[0]?.quotaLimit)).toBe(10);
  });
  it("rejects duplicate names and malformed status within the guarded transaction", async () => {
    const create = await authority.prepare("CreateTemplate", actor, request());
    await expect(
      repository.createTemplate(
        { name: prefix, defaultQuota: 100, status: 1, publishStatus: "draft" },
        [],
        create!.guard,
      ),
    ).rejects.toMatchObject({ statusCode: 400, messageKey: "monthlyPass.templateNameExists" });
    const source = await prepared();
    await expect(repository.updateTemplate(template, { status: 2 }, undefined, source!.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rolls back authorization revision changes during the transaction", async () => {
    const source = await prepared();
    vi.spyOn(revisions, "readIamAuthorizationRevision")
      .mockResolvedValueOnce("before")
      .mockResolvedValueOnce("changed");
    await expect(
      repository.updateTemplate(template, { description: "revision drift" }, undefined, source!.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await repository.findTemplateById(template))?.description).toBeNull();
  });
});
