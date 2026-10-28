import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { platformMonthlyPassUsageArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { PlatformMonthlyPassUsageReadIamService } from "@/services/billing/platform-monthly-pass-usage-read-iam.service";
import { PlatformMonthlyPassUsageReadRepository } from "@/store/billing/platform-monthly-pass-usage-read.repository";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode,
  action = "quyan:monthly_pass:ListUsages";
let owner: string,
  actor: string,
  customer: string,
  groupId: string,
  templateId: string,
  passId: string,
  first: string,
  second: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "monthly-usage-" + randomUUID(),
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
    ip: "192.0.2.3",
  }) as unknown as TypedRequest;
const read = (page = 1, pageSize = 20, filters = {}) =>
  PlatformMonthlyPassUsageReadIamService.getInstance().list(
    request(),
    { page, pageSize },
    filters,
    (view) => view,
    async () => {
      throw new Error("legacy must not run");
    },
  );
async function policy(Effect: "Allow" | "Deny", Resource: string) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect, Action: action, Resource } });
  const p = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "monthly-usage-policy-" + randomUUID(),
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
  owner = await user();
  actor = await user(owner);
  customer = await user();
  groupId = (
    await prisma.group.create({
      data: {
        username: "monthly-usage-global-" + randomUUID(),
        name: "fixture global usage read",
        level: 0,
        accountOwnerId: null,
        permissions: [Permission.MONTHLY_PASS_USAGE_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  templateId = (
    await prisma.monthlyPassTemplate.create({ data: { name: "fixture-template-" + randomUUID(), defaultQuota: 100 } })
  ).id;
  passId = (
    await prisma.userMonthlyPass.create({
      data: {
        userId: customer,
        templateId,
        startAt: new Date("2026-01-01"),
        endAt: new Date("2027-01-01"),
        totalQuota: 100,
        remainingQuota: 100,
      },
    })
  ).id;
  const data = {
    userId: customer,
    userMonthlyPassId: passId,
    model: "fixture-model",
    channelName: "fixture historical channel",
    coveredAmount: 1,
    totalRequestCost: 2,
    remainingRequestCost: 1,
  };
  first = (await prisma.monthlyPassUsage.create({ data: { ...data, createTime: new Date("2026-02-02") } })).id;
  second = (await prisma.monthlyPassUsage.create({ data: { ...data, createTime: new Date("2026-02-01") } })).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  await prisma.monthlyPassTemplate.deleteMany({ where: { id: templateId } });
});
describe("persisted monthly pass usage authorization", () => {
  it("preserves platform global qualification and exact historical row content", async () => {
    expect(await read(1, 1)).toMatchObject({
      total: 2,
      records: [
        {
          record: { id: first, userId: customer, userMonthlyPassId: passId },
          templateId,
          templateName: expect.any(String),
        },
      ],
    });
    expect(
      await MonthlyPassService.getInstance().listUsages(
        1,
        1,
        customer,
        templateId,
        undefined,
        undefined,
        undefined,
        request(),
      ),
    ).toMatchObject({
      total: 2,
      records: [
        {
          id: first,
          coveredAmount: 1,
          totalRequestCost: 2,
          remainingRequestCost: 1,
          displayChannelName: "fixture historical channel",
        },
      ],
    });
  });
  it("filters explicit Deny before page hydration and counting", async () => {
    await policy("Deny", platformMonthlyPassUsageArn(customer, passId, first));
    const hydrate = vi.spyOn(PlatformMonthlyPassUsageReadRepository.getInstance(), "hydrate");
    expect(await read(1, 1)).toMatchObject({ total: 1, records: [{ record: { id: second } }] });
    expect(hydrate.mock.calls[0]![1].map((row) => row.target.id)).toEqual([second]);
  });
  it("supports least-privilege JSON grants without globalizing a template name", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([
      {
        policyId: "fixture-native",
        document: parseIamPolicy({
          Version: "1",
          Statement: {
            Effect: "Allow",
            Action: action,
            Resource: platformMonthlyPassUsageArn(customer, passId, first),
          },
        }).document,
      },
    ]);
    expect(await read()).toMatchObject({ total: 1, records: [{ record: { id: first } }] });
    expect((await read()).records[0]).not.toHaveProperty("templateName");
  });
  it("projects a denied template name as an empty DTO field", async () => {
    await policy("Deny", platformTemplateArn("monthly-pass", templateId));
    expect((await read()).records[0]).not.toHaveProperty("templateName");
    expect(
      (
        await MonthlyPassService.getInstance().listUsages(
          1,
          20,
          customer,
          templateId,
          undefined,
          undefined,
          undefined,
          request(),
        )
      ).records[0]?.templateName,
    ).toBe("");
  });
  it("does not fetch template names if every template contribution is denied", async () => {
    await policy("Deny", platformTemplateArn("monthly-pass", templateId));
    const transaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((callback: any, options: any) =>
      transaction(async (tx) => {
        const wrapped = new Proxy(tx, {
          get(target, key, receiver) {
            if (key === "monthlyPassTemplate")
              return new Proxy(target.monthlyPassTemplate, {
                get(delegate, method, delegateReceiver) {
                  if (method === "findMany")
                    return () => {
                      throw new Error("denied template was hydrated");
                    };
                  return Reflect.get(delegate, method, delegateReceiver);
                },
              });
            return Reflect.get(target, key, receiver);
          },
        });
        return callback(wrapped);
      }, options)) as any);
    expect((await read()).total).toBe(2);
  });
  it("rejects missing persisted global eligibility even with a wildcard policy", async () => {
    await policy("Allow", "*");
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("returns no rows when policies contain no matching Allow", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
    expect(await read()).toMatchObject({ total: 0, records: [] });
  });
  it("keeps customer, template, model and time filters exact", async () => {
    expect(
      (
        await read(1, 20, {
          userId: customer,
          templateId,
          model: "fixture-model",
          startAt: new Date("2026-02-02"),
          endAt: new Date("2026-02-02"),
        })
      ).total,
    ).toBe(1);
    expect((await read(1, 20, { userId: owner })).total).toBe(0);
    expect((await read(1, 20, { userId: customer.toUpperCase() })).total).toBe(0);
    expect((await read(1, 20, { model: "FIXTURE-MODEL" })).total).toBe(0);
  });
  it.each(["usage", "template"])("rejects %s edits with an unchanged updateTime", async (kind) => {
    const repo = PlatformMonthlyPassUsageReadRepository.getInstance(),
      hydrate = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const result = await hydrate(...args);
      if (kind === "usage") {
        const row = await prisma.monthlyPassUsage.findUniqueOrThrow({ where: { id: first } });
        await prisma.monthlyPassUsage.update({
          where: { id: first },
          data: { description: "changed content", updateTime: row.updateTime },
        });
      } else {
        const row = await prisma.monthlyPassTemplate.findUniqueOrThrow({ where: { id: templateId } });
        await prisma.monthlyPassTemplate.update({
          where: { id: templateId },
          data: { name: "changed-template-" + randomUUID(), updateTime: row.updateTime },
        });
      }
      return result;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects policy revocation while hydrating the authorized page", async () => {
    const repo = PlatformMonthlyPassUsageReadRepository.getInstance(),
      hydrate = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const result = await hydrate(...args);
      await policy("Deny", platformMonthlyPassUsageArn(customer, passId, first));
      return result;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
});
