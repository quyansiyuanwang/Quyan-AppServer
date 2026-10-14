import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { buildAcsResource, IAM_AUTHENTICATED_SELF_ACTIONS, authenticatedSelfResourcePatterns } from "@quyan/shared";
import {
  monthlyPassAssignmentArn,
  monthlyPassTemplateArn,
  monthlyPassUsageArn,
} from "@/iam/resources/monthly-pass-resources";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
let owner: string,
  actor: string,
  customer: string,
  templateId: string,
  passId: string,
  otherId: string,
  foreignId: string,
  usageId: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "client:Fake", "x-account-id": "foreign" },
    secure: true,
    ip: "192.0.2.90",
  }) as unknown as TypedRequest;
const read = (page = 1, pageSize = 20, req = request()) =>
  MonthlyPassService.getInstance().listMyPasses(actor, req, page, pageSize);
async function deny(Resource: string, Condition?: unknown) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: {
      Effect: "Deny",
      Action: "quyan:monthly_pass:ListMyPasses",
      Resource,
      ...(Condition ? { Condition } : {}),
    },
  });
  const p = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "monthly-personal-deny-" + randomUUID(),
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
          username: "monthly-personal-" + randomUUID(),
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
  templateId = (
    await prisma.monthlyPassTemplate.create({
      data: {
        name: "monthly-template-" + randomUUID(),
        defaultQuota: 100,
        description: "fixture own template details",
        allowedModels: '["fixture-model"]',
      },
    })
  ).id;
  const data = {
    templateId,
    startAt: new Date("2026-01-01"),
    endAt: new Date("2027-01-01"),
    totalQuota: 100,
    usedQuota: 10,
    remainingQuota: 90,
  };
  passId = (
    await prisma.userMonthlyPass.create({
      data: {
        ...data,
        userId: actor,
        createTime: new Date("2026-01-02"),
        quotaWindows: { create: { quotaLimit: 20, quotaUnit: "amount", quotaWindowHours: 24 } },
      },
    })
  ).id;
  otherId = (
    await prisma.userMonthlyPass.create({
      data: {
        ...data,
        userId: actor,
        createTime: new Date("2026-01-03"),
        endAt: new Date("2027-02-01"),
        dailyQuota: 10,
        quotaWindowHours: 12,
      },
    })
  ).id;
  foreignId = (await prisma.userMonthlyPass.create({ data: { ...data, userId: customer } })).id;
  usageId = (
    await prisma.monthlyPassUsage.create({
      data: {
        userId: actor,
        userMonthlyPassId: passId,
        coveredAmount: 10,
        totalRequestCost: 10,
        remainingRequestCost: 0,
      },
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  await prisma.monthlyPassTemplate.deleteMany({ where: { id: templateId } });
});
describe("personal monthly pass resource admission", () => {
  it("grants registered self children without a platform management group and never exposes peers", async () => {
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).toContain("quyan:monthly_pass:ListMyPasses");
    expect(authenticatedSelfResourcePatterns(owner, actor)).toContain(
      "acs:monthly-pass:*:" + owner + ":assignment/" + actor + "/*",
    );
    const result = await read(1, 1);
    expect(result).toMatchObject({
      total: 2,
      records: [
        {
          id: passId,
          userId: actor,
          templateName: expect.any(String),
          usedQuota: 10,
          remainingQuota: 90,
          quotaWindows: [{ quotaLimit: 20, usedQuota: 10, remainingQuota: 10 }],
        },
      ],
    });
    expect(result.records.every((row) => row.id !== foreignId)).toBe(true);
    expect(await read(2, 1)).toMatchObject({ records: [{ id: otherId }] });
  });
  it("keeps legacy fallback windows consistent with native usage aggregation", async () => {
    const result = await read(2, 1);
    expect(result.records[0]?.quotaWindows[0]).toMatchObject({
      quotaLimit: 10,
      quotaUnit: "amount",
      quotaWindowHours: 12,
    });
  });
  it("filters explicit Deny before totals and pagination", async () => {
    await deny(monthlyPassAssignmentArn(owner, actor, passId));
    expect(await read(1, 1)).toMatchObject({ total: 1, records: [{ id: otherId }] });
  });
  it("withholds denied template details without hiding an allowed assignment", async () => {
    await deny(monthlyPassTemplateArn(owner, actor, templateId));
    const result = await read(1, 1);
    expect(result.records[0]?.templateName).toBe("");
    expect(result.records[0]?.templateDescription).toBeUndefined();
    expect(result.records[0]?.allowedModels).toBeUndefined();
    expect(result.records[0]?.totalQuota).toBe(100);
  });
  it("withholds complete quota-window counters when any relevant usage is denied", async () => {
    await deny(monthlyPassUsageArn(owner, actor, passId, usageId));
    const result = await read(1, 1);
    expect(result.records[0]?.quotaWindows[0]?.usedQuota).toBeUndefined();
    expect(result.records[0]?.quotaWindows[0]?.remainingQuota).toBeUndefined();
    expect(result.records[0]?.usedQuota).toBe(10);
  });
  it("keeps username authorization independent from primary collection admission", async () => {
    await deny(buildAcsResource({ service: "quyan", region: "*", accountId: owner, path: "user/" + actor }));
    expect((await read(1, 1)).records[0]?.username).toBeUndefined();
  });
  it("evaluates real source-IP conditions rather than client action/account hints", async () => {
    await deny(monthlyPassAssignmentArn(owner, actor, passId), { IpAddress: { "acs:SourceIp": "192.0.2.0/24" } });
    expect(await read()).toMatchObject({ total: 1, records: [{ id: otherId }] });
    const req = request();
    Object.defineProperty(req, "ip", { value: "198.51.100.1", configurable: true });
    expect((await read(1, 20, req)).total).toBe(2);
  });
  it("rejects cross-owner usage references instead of accepting a second broad Allow", async () => {
    await prisma.monthlyPassUsage.update({ where: { id: usageId }, data: { userId: customer } });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects an unavailable account owner and a caller requesting another subject", async () => {
    await expect(MonthlyPassService.getInstance().listMyPasses(customer, request(), 1, 20)).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("revalidates previously allowed decisions before the personal read transaction ends", async () => {
    await deny(monthlyPassAssignmentArn(owner, actor, passId), { IpAddress: { "acs:SourceIp": "198.51.100.0/24" } });
    const req = request(),
      iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    let changed = false;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await authorize(input);
      if (!changed) {
        changed = true;
        Object.defineProperty(req, "ip", { value: "198.51.100.1", configurable: true });
      }
      return result;
    });
    await expect(read(1, 20, req)).rejects.toMatchObject({ statusCode: 403 });
  });
});
