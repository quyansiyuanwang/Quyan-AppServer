import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { MonthlyPassService } from "@/services/billing/monthly-pass.service";
import { MonthlyPassRepository } from "@/store/billing/monthly-pass.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { monthlyPassTemplateArn } from "@/iam/resources/monthly-pass-resources";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, offers: string[], draft: string, disabled: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "offer-read-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = (context: Partial<NonNullable<TypedRequest["authContext"]>> = {}) =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user", ...context },
    headers: {},
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const read = (req = request()) => MonthlyPassService.getInstance().listPublishedTemplates(req);
async function deny(resource: string, action = "quyan:monthly_pass:ListPublishedTemplates") {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "offer-deny-" + randomUUID(),
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
  peer = await user(owner);
  offers = [];
  const offer = async (status: number, publishStatus: string, at: number) =>
    (
      await prisma.monthlyPassTemplate.create({
        data: {
          name: "published-offer-" + randomUUID(),
          status,
          publishStatus,
          publishedAt: new Date(Date.UTC(2026, at, 1)),
          defaultQuota: 100,
          discountedPrice: 1,
          allowBalanceRedemption: true,
          quotaWindows: { create: { quotaLimit: 10, quotaUnit: "amount", quotaWindowHours: 24 } },
        },
      })
    ).id;
  offers.push(await offer(1, "published", 9), await offer(1, "published", 8));
  draft = await offer(1, "draft", 10);
  disabled = await offer(0, "published", 11);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.monthlyPassTemplate.deleteMany({ where: { id: { in: [...offers, draft, disabled] } } });
  env.security.iamAuthorizationMode = mode;
});
describe("IAM published monthly pass offer reads", () => {
  it("keeps the published ordering and pricing without platform management access", async () => {
    const legacy = vi.spyOn(MonthlyPassRepository.getInstance(), "listPublishedTemplates");
    const result = await read();
    expect(result.map((row) => row.id)).toEqual(offers);
    expect(result[0]).toMatchObject({
      discountedPrice: 1,
      defaultQuota: 100,
      quotaWindows: [expect.objectContaining({ quotaLimit: 10, quotaUnit: "amount", quotaWindowHours: 24 })],
      status: 1,
      publishStatus: "published",
    });
    expect(result.map((row) => row.id)).not.toContain(draft);
    expect(result.map((row) => row.id)).not.toContain(disabled);
    expect(legacy).not.toHaveBeenCalled();
  });
  it("filters a specific denied offer", async () => {
    await deny(monthlyPassTemplateArn(owner, actor, offers[0]!));
    expect((await read()).map((row) => row.id)).toEqual([offers[1]]);
  });
  it("honors wildcard Deny despite the authenticated offer baseline", async () => {
    await deny("acs:monthly-pass:*:" + owner + ":template/" + actor + "/*");
    expect(await read()).toEqual([]);
  });
  it("does not apply a same-account peer's offer scope to the actor", async () => {
    await deny(monthlyPassTemplateArn(owner, peer, offers[0]!));
    expect((await read()).map((row) => row.id)).toEqual(offers);
  });
  it("keeps viewing and purchasing actions independent", async () => {
    await deny(monthlyPassTemplateArn(owner, actor, offers[0]!), "quyan:monthly_pass:ClaimPublishedTemplate");
    expect((await read()).map((row) => row.id)).toEqual(offers);
  });
  it("rejects forged account ownership and disabled identities", async () => {
    const foreign = await user();
    await expect(read(request({ accountOwnerId: foreign }))).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks every admitted decision before returning the collection", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (++count > 1) return result.map((row) => ({ ...row, decision: "ExplicitDeny", reason: "explicit-deny" }));
      return result;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never hydrates denied templates and keeps purchase decisions independent", async () => {
    await deny(monthlyPassTemplateArn(owner, actor, offers[0]!));
    const transaction = prisma.$transaction.bind(prisma),
      queries: Prisma.MonthlyPassTemplateFindManyArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const find = tx.monthlyPassTemplate.findMany.bind(tx.monthlyPassTemplate);
        vi.spyOn(tx.monthlyPassTemplate, "findMany").mockImplementation((args) => {
          if (args) queries.push(args);
          return find(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    expect((await read()).map((row) => row.id)).toEqual([offers[1]]);
    const detailReads = queries.filter((input) => input.select && "quotaWindows" in input.select);
    expect(detailReads.length).toBeGreaterThan(0);
    for (const input of detailReads) expect((input?.where?.id as { in: string[] }).in).not.toContain(offers[0]);
  });
  it("fails closed when request conditions change before the final decision", async () => {
    const req = request();
    await deny("*", "quyan:monthly_pass:ClaimPublishedTemplate");
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:monthly_pass:ListPublishedTemplates",
        Resource: "*",
        Condition: { StringEquals: { "acs:UserAgent": "denied-client" } },
      },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "offer-condition-" + randomUUID(),
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
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let calls = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (++calls === 1) req.headers["user-agent"] = "denied-client";
      return result;
    });
    await expect(read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("accepts AccessKey identity through the same trusted context", async () => {
    expect((await read(request({ subjectType: "access_key" }))).map((row) => row.id)).toEqual(offers);
  });
  it("rejects a missing role session and missing request in enforce mode", async () => {
    await expect(
      read(request({ roleSessionId: "missing-session", assumedRoleId: "missing-role" })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(MonthlyPassService.getInstance().listPublishedTemplates()).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
