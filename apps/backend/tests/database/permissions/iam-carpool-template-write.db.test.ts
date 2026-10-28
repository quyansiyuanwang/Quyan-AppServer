import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { CarpoolService } from "@/services/billing/carpool.service";
import { CarpoolRepository } from "@/store/billing/carpool.repository";
import { PlatformCarpoolTemplateWriteIamService } from "@/services/billing/platform-carpool-template-write-iam.service";
import { bindCarpoolTemplateWrite } from "@/store/billing/carpool-template-write";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { Permission } from "@quyan/shared";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformTemplateArn, platformCarpoolTemplateControlArn } from "@/iam/resources/platform-template-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = CarpoolService.getInstance(),
  repository = CarpoolRepository.getInstance(),
  authority = PlatformCarpoolTemplateWriteIamService.getInstance();
let owner: string, actor: string, groupId: string, monthlyId: string, template: string, prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const input = () => ({
  name: prefix + "-created",
  salePrice: 10,
  upstreamCost: 5,
  maxMembers: 3,
  monthlyPassTemplateId: monthlyId,
});
const update = () => service.updateTemplate(template, { ...input(), name: prefix + "-edited" }, request());
async function deny(operation: string, resource = platformTemplateArn("carpool", template)) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:carpool:" + operation, Resource: resource },
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
  prefix = "carpool-write-" + randomUUID();
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
        name: "Fixture carpool manager",
        accountOwnerId: null,
        permissions: [Permission.CARPOOL_TEMPLATE_WRITE],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  monthlyId = (await prisma.monthlyPassTemplate.create({ data: { name: prefix, defaultQuota: 100, validityDays: 30 } }))
    .id;
  template = (
    await prisma.carpoolPackageTemplate.create({
      data: { ...input(), name: prefix, snapshotQuota: 100, snapshotValidityDays: 30 },
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.carpoolPackageTemplate.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.monthlyPassTemplate.deleteMany({ where: { name: { startsWith: prefix } } });
  env.security.iamAuthorizationMode = mode;
});
async function bound() {
  const prepared = await authority.prepare("UpdateTemplate", actor, request(), template, monthlyId);
  const source = prepared!.guard.monthlySource!.record;
  const data = {
    ...input(),
    snapshotQuota: source.defaultQuota,
    snapshotValidityDays: source.validityDays,
    snapshotQuotaUnit: source.quotaUnit,
    snapshotQuotaWindowHours: source.quotaWindowHours,
    snapshotAllowedModels: source.allowedModels,
    snapshotAllowedChannels: source.allowedChannels,
  };
  bindCarpoolTemplateWrite(prepared!.guard, data);
  return { data, guard: prepared!.guard };
}
describe("carpool template resource authorization and transaction", () => {
  it("creates, updates, copies, publishes, unpublishes and archives through native business paths", async () => {
    const created = await service.createTemplate(input(), request());
    expect(created).toMatchObject({ snapshotQuota: 100, salePrice: 10, upstreamCost: 5, publishStatus: "draft" });
    expect((await update()).name).toBe(prefix + "-edited");
    const copy = await service.duplicateTemplate(template, request());
    expect(copy.id).not.toBe(template);
    expect(copy).toMatchObject({ snapshotQuota: 100, publishStatus: "draft" });
    expect((await service.publishTemplate(template, true, request())).publishStatus).toBe("published");
    expect((await service.publishTemplate(template, false, request())).publishStatus).toBe("draft");
    await service.archiveTemplate(template, request());
    expect(await prisma.carpoolPackageTemplate.findUniqueOrThrow({ where: { id: template } })).toMatchObject({
      status: -1,
      publishStatus: "draft",
    });
  });
  it.each(["UpdateTemplate", "DuplicateTemplate", "ArchiveTemplate", "PublishTemplate", "UnpublishTemplate"])(
    "denies %s on the selected source",
    async (operation) => {
      await deny(operation);
      const actions: Record<string, () => Promise<unknown>> = {
        UpdateTemplate: update,
        DuplicateTemplate: () => service.duplicateTemplate(template, request()),
        ArchiveTemplate: () => service.archiveTemplate(template, request()),
        PublishTemplate: () => service.publishTemplate(template, true, request()),
        UnpublishTemplate: () => service.publishTemplate(template, false, request()),
      };
      await expect(actions[operation]!()).rejects.toMatchObject({ statusCode: 403 });
      expect((await prisma.carpoolPackageTemplate.findUniqueOrThrow({ where: { id: template } })).name).toBe(prefix);
    },
  );
  it("denies create control and the monthly-pass snapshot independently", async () => {
    await deny("CreateTemplate", platformCarpoolTemplateControlArn());
    await expect(service.createTemplate(input(), request())).rejects.toMatchObject({ statusCode: 403 });
    await deny("UpdateTemplate", platformTemplateArn("monthly-pass", monthlyId));
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.carpoolPackageTemplate.count({ where: { name: { startsWith: prefix } } })).toBe(1);
  });
  it.each(["CreateTemplate", "DuplicateTemplate"] as const)(
    "rolls back %s when the generated resource is denied",
    async (operation) => {
      const iam = IamAuthorizationService.getInstance(),
        original = iam.authorize.bind(iam);
      vi.spyOn(iam, "authorize").mockImplementation(async (args) => {
        const result = await original(args);
        if (
          args.action === "quyan:carpool:" + operation &&
          args.resource.includes(":carpool-template/") &&
          args.resource !== platformTemplateArn("carpool", template)
        )
          return { ...result, decision: "ExplicitDeny", reason: "explicit-deny" };
        return result;
      });
      await expect(
        operation === "CreateTemplate"
          ? service.createTemplate(input(), request())
          : service.duplicateTemplate(template, request()),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await prisma.carpoolPackageTemplate.count({ where: { name: { startsWith: prefix } } })).toBe(1);
    },
  );
  it.each(["target", "monthly"])("rejects changed %s values even with the original timestamp", async (which) => {
    const source = await bound();
    if (which === "target") {
      const old = await prisma.carpoolPackageTemplate.findUniqueOrThrow({ where: { id: template } });
      await prisma.carpoolPackageTemplate.update({
        where: { id: template },
        data: { salePrice: 99, updateTime: old.updateTime },
      });
    } else {
      const old = await prisma.monthlyPassTemplate.findUniqueOrThrow({ where: { id: monthlyId } });
      await prisma.monthlyPassTemplate.update({
        where: { id: monthlyId },
        data: { defaultQuota: 200, updateTime: old.updateTime },
      });
    }
    await expect(repository.updateTemplate(template, source.data, source.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.carpoolPackageTemplate.findUniqueOrThrow({ where: { id: template } })).name).toBe(prefix);
  });
  it("rejects changed pricing payloads and restores policy revocation after preparation", async () => {
    const source = await bound();
    await expect(
      repository.updateTemplate(template, { ...source.data, salePrice: 100 }, source.guard),
    ).rejects.toMatchObject({ statusCode: 403 });
    await deny("UpdateTemplate");
    await expect(repository.updateTemplate(template, source.data, source.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rolls back mutation if the final authorization recheck fails", async () => {
    const source = await bound();
    source.guard.recheckEntry = async () => {
      throw iamAccountDenied();
    };
    await expect(repository.updateTemplate(template, source.data, source.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.carpoolPackageTemplate.findUniqueOrThrow({ where: { id: template } })).name).toBe(prefix);
  });
  it("does not convert account-owned groups or account policies into platform management qualification", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a removed management permission and a forged account context", async () => {
    const source = await bound();
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await expect(repository.updateTemplate(template, source.data, source.guard)).rejects.toMatchObject({
      statusCode: 403,
    });
    const req = request();
    req.authContext!.accountOwnerId = "foreign";
    await expect(service.archiveTemplate(template, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires a native Allow, missing sessions and missing requests fail closed", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
    await expect(update()).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    const req = request();
    req.authContext!.roleSessionId = "missing-session";
    req.authContext!.assumedRoleId = "missing-role";
    await expect(service.archiveTemplate(template, req)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.archiveTemplate(template)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("preserves copied snapshot terms after the upstream template has changed", async () => {
    await prisma.monthlyPassTemplate.update({ where: { id: monthlyId }, data: { defaultQuota: 200 } });
    expect((await service.duplicateTemplate(template, request())).snapshotQuota).toBe(100);
  });
});
