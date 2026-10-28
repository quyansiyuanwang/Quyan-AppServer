import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformTemplateReadIamService } from "@/services/billing/platform-template-read-iam.service";
import { PlatformTemplateReadRepository } from "@/store/billing/platform-template-read.repository";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  repository = PlatformTemplateReadRepository.getInstance("monthly-pass");
let owner: string, actor: string, groupId: string;
let templates: string[], windowIds: string[];
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "monthly-template-iam-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "client:Fake" },
    secure: true,
    ip: "192.0.2.30",
  }) as unknown as TypedRequest;
const principal = () => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user" as const,
});
const read = (page = 1, pageSize = 1) =>
  PlatformTemplateReadIamService.getInstance("monthly-pass").list(
    request(),
    { page, pageSize },
    {},
    (row) => ({ id: row.id, name: row.name, quotaWindows: row.quotaWindows }),
    async () => {
      throw new Error("legacy must not run");
    },
  );
async function deny(id: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: "Deny",
      Action: "quyan:monthly_pass:ListTemplates",
      Resource: platformTemplateArn("monthly-pass", id),
    },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "monthly-template-deny-" + randomUUID(),
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
  owner = await user();
  actor = await user(owner);
  groupId = (
    await prisma.group.create({
      data: {
        username: "monthly-template-global-" + randomUUID(),
        name: "fixture platform monthly templates",
        level: 0,
        accountOwnerId: null,
        permissions: [Permission.MONTHLY_PASS_TEMPLATE_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  templates = [];
  windowIds = [];
  for (let index = 0; index < 2; index++) {
    const record = await prisma.monthlyPassTemplate.create({
      data: {
        name: (index === 0 ? "A-" : "Z-") + randomUUID(),
        description: "PRIVATE-MONTHLY-" + index,
        defaultQuota: 10,
        allowedChannels: "PRIVATE-CHANNELS-" + index,
        createTime: new Date("2026-01-0" + (index + 1)),
        quotaWindows: {
          create: [
            { quotaUnit: "amount", quotaLimit: 10, quotaWindowHours: 24 },
            { quotaUnit: "request", quotaLimit: 500, quotaWindowHours: 1 },
          ],
        },
      },
      include: { quotaWindows: true },
    });
    templates.push(record.id);
    windowIds.push(record.quotaWindows[0]!.id);
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.monthlyPassTemplate.deleteMany({ where: { id: { in: templates } } });
  env.security.iamAuthorizationMode = mode;
});
describe("monthly template resource admission and quota snapshot", () => {
  it("filters denied templates before loading quota windows and uses authorized totals", async () => {
    await deny(templates[0]!);
    const hydrate = vi.spyOn(repository, "hydrate");
    const result = await read();
    expect(result.total).toBe(1);
    expect(result.records.map((row) => row.id)).toEqual([templates[1]]);
    expect(result.records[0]!.quotaWindows).toHaveLength(2);
    expect(hydrate.mock.calls[0][1].map((row) => row.id)).toEqual([templates[1]]);
  });
  it("returns only safe hashes and numeric ordering metadata from scans", async () => {
    const rows = await repository.scan({});
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("PRIVATE");
    expect(Object.keys(rows[0]!).sort()).toEqual([
      "createTime",
      "displayOrder",
      "id",
      "revision",
      "status",
      "updateTime",
    ]);
  });
  it("preserves alphabetical template ordering independently of metadata scan order", async () => {
    expect((await read()).records[0]!.id).toBe(templates[0]);
    expect((await read(2)).records[0]!.id).toBe(templates[1]);
    expect((await read(3)).records).toEqual([]);
  });
  it.each(["modify", "delete", "insert"] as const)(
    "detects child quota %s without changing the parent timestamp",
    async (operation) => {
      const before = await prisma.monthlyPassTemplate.findUniqueOrThrow({ where: { id: templates[0] } }),
        targets = await repository.scan({});
      if (operation === "modify")
        await prisma.$executeRaw`UPDATE monthly_pass_template_quota_windows SET quotaLimit=99 WHERE id=${windowIds[0]}`;
      else if (operation === "delete")
        await prisma.monthlyPassTemplateQuotaWindow.delete({ where: { id: windowIds[0] } });
      else
        await prisma.monthlyPassTemplateQuotaWindow.create({
          data: { monthlyPassTemplateId: templates[0]!, quotaUnit: "token", quotaLimit: 1000, quotaWindowHours: 48 },
        });
      const after = await prisma.monthlyPassTemplate.findUniqueOrThrow({ where: { id: templates[0] } });
      expect(after.updateTime.getTime()).toBe(before.updateTime.getTime());
      const current = await repository.scan({});
      expect(current.find((row) => row.id === templates[0])?.revision).not.toBe(
        targets.find((row) => row.id === templates[0])?.revision,
      );
      await expect(repository.hydrate(principal(), targets)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("rejects a quota change after hydration and before returning the page", async () => {
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementationOnce(async (actor, targets) => {
      const result = await hydrate(actor, targets);
      await prisma.$executeRaw`UPDATE monthly_pass_template_quota_windows SET quotaLimit=99 WHERE id=${windowIds[0]}`;
      return result;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires a persisted global platform management group", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    const scan = vi.spyOn(repository, "scan");
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(scan).not.toHaveBeenCalled();
  });
  it("has stable hashes across repeated scans and ordered quota DTOs", async () => {
    expect(await repository.scan({})).toEqual(await repository.scan({}));
    const result = await MonthlyPassService.getInstance().listTemplates(1, 10, undefined, undefined, request());
    expect(result.records.map((row) => row.id)).toEqual(templates);
    expect(result.records[0]?.quotaWindows.map((row) => row.quotaWindowHours)).toEqual([1, 24]);
  });
  it.each([null, 5])("preserves legacy quota-window semantics for daily quota %j", async (dailyQuota) => {
    await prisma.monthlyPassTemplateQuotaWindow.deleteMany({ where: { monthlyPassTemplateId: templates[0] } });
    await prisma.monthlyPassTemplate.update({
      where: { id: templates[0] },
      data: { dailyQuota, quotaWindowHours: dailyQuota === null ? null : 24 },
    });
    const result = await MonthlyPassService.getInstance().listTemplates(1, 1, undefined, undefined, request());
    expect(result.records[0]?.id).toBe(templates[0]);
    if (dailyQuota === null) expect(result.records[0]?.quotaWindows).toEqual([]);
    else
      expect(result.records[0]?.quotaWindows).toMatchObject([
        { quotaLimit: 5, quotaUnit: "amount", quotaWindowHours: 24 },
      ]);
  });
});
