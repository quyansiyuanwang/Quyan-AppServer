import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { TerminalPurchaseIamService } from "@/services/remote-terminal/terminal-purchase-iam.service";
import { TerminalPurchaseRepository } from "@/store/remote-terminal-product/terminal-purchase.repository";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { RemoteTerminalProductRepository } from "@/store/remote-terminal-product/remote-terminal-product.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  remoteTerminalProductEntitlementArn,
  remoteTerminalPublishedTemplateArn,
} from "@/iam/resources/remote-terminal-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  repository = TerminalPurchaseRepository.getInstance(),
  authority = TerminalPurchaseIamService.getInstance();
let owner: string, actor: string, peer: string, template: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "terminal-purchase-" + randomUUID(),
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
    headers: {},
    secure: true,
    ip: "192.0.2.42",
  }) as unknown as TypedRequest;
const body = () => ({ templateId: template, purchaseUnits: 1, deviceCount: 1, terminalCount: 0 });
const data = () => ({
  kind: "create" as const,
  chargeAmount: 1,
  entitlement: {
    userId: actor,
    templateId: template,
    name: "fixture entitlement",
    startAt: new Date("2026-01-01"),
    endAt: new Date("2027-01-01"),
    deviceLimit: 1,
    terminalLimit: 0,
    status: 1,
    assignedBy: actor,
    purchaseAmount: 1,
  },
});
const prepared = (id?: string) => authority.prepare(actor, request(), template, id);
async function deny(resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:remote_terminal:ClaimPublishedTemplate", Resource: resource },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "purchase-deny-" + randomUUID(),
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
  await prisma.balanceAccount.create({ data: { userId: actor, balance: 100 } });
  template = (
    await prisma.remoteTerminalProductTemplate.create({
      data: {
        name: "fixture-purchase-" + randomUUID(),
        devicePrice: 1,
        terminalPrice: 2,
        billingUnit: "day",
        publishStatus: "published",
        minimumPurchaseUnits: 1,
        minimumDeviceCount: 1,
        minimumTerminalCount: 0,
        purchaseLimitPerUser: 1,
        purchaseLimitWindowDays: 30,
      },
    })
  ).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
});
async function unchanged() {
  expect(Number((await prisma.balanceAccount.findUnique({ where: { userId: actor } }))!.balance)).toBe(100);
  expect(await prisma.balanceTransaction.count({ where: { userId: actor } })).toBe(0);
  expect(await prisma.remoteTerminalUserEntitlement.count({ where: { userId: actor } })).toBe(0);
}
describe("terminal purchase transaction authority", () => {
  it("purchases through the self baseline and commits the current charge without credential hydration", async () => {
    const legacy = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "purchaseEntitlement"),
      tokens = vi.spyOn(RemoteTerminalProductRepository.getInstance(), "upsertEntitlementToken");
    const result = await RemoteTerminalProductService.getInstance().claimPublishedTemplate(body(), actor, request());
    expect(result).toMatchObject({ userId: actor, purchaseAmount: 1 });
    expect(result.registrationToken).toBeUndefined();
    expect(result.username).toBeUndefined();
    expect(legacy).not.toHaveBeenCalled();
    expect(tokens).not.toHaveBeenCalled();
    expect(Number((await prisma.balanceAccount.findUnique({ where: { userId: actor } }))!.balance)).toBe(99);
    expect(Number((await prisma.balanceTransaction.findFirst({ where: { userId: actor } }))!.amount)).toBe(-1);
  });
  it.each(["user", "offer", "generated entitlement"])(
    "rejects %s denial without any charge or persisted state",
    async (kind) => {
      await deny(
        kind === "user"
          ? "acs:quyan:*:" + owner + ":user/" + actor
          : kind === "offer"
            ? remoteTerminalPublishedTemplateArn(owner, actor, template)
            : "acs:remote-terminal:*:" + owner + ":product-entitlement/" + actor + "/*",
      );
      await expect(
        RemoteTerminalProductService.getInstance().claimPublishedTemplate(body(), actor, request()),
      ).rejects.toMatchObject({ statusCode: 403 });
      await unchanged();
    },
  );
  it("rolls back the balance, ledger and entitlement after final authorization fails", async () => {
    const source = (await prepared())!;
    source.guard.recheckEntry = async () => {
      throw iamAccountDenied();
    };
    await expect(repository.purchase(data(), source.guard)).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it.each(["price", "publication"])("rejects changed template %s before charging", async (kind) => {
    const source = (await prepared())!;
    if (kind === "price")
      await prisma.$executeRaw`UPDATE remote_terminal_product_templates SET devicePrice=4 WHERE id=${template}`;
    else
      await prisma.$executeRaw`UPDATE remote_terminal_product_templates SET publishStatus='draft' WHERE id=${template}`;
    await expect(repository.purchase(data(), source.guard)).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("serializes two purchases of the final allowed slot", async () => {
    const first = (await prepared())!,
      second = (await prepared())!;
    const results = await Promise.allSettled([
      repository.purchase(data(), first.guard),
      repository.purchase(data(), second.guard),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(Number((await prisma.balanceAccount.findUnique({ where: { userId: actor } }))!.balance)).toBe(99);
    expect(await prisma.balanceTransaction.count({ where: { userId: actor } })).toBe(1);
  });
  it("charges only the renewal delta and stores the cumulative amount", async () => {
    const first = await RemoteTerminalProductService.getInstance().claimPublishedTemplate(body(), actor, request());
    const result = await RemoteTerminalProductService.getInstance().claimPublishedTemplate(
      { ...body(), targetEntitlementId: first.id },
      actor,
      request(),
    );
    expect(result.purchaseAmount).toBe(2);
    expect(Number((await prisma.balanceAccount.findUnique({ where: { userId: actor } }))!.balance)).toBe(98);
    expect(
      (await prisma.balanceTransaction.findMany({ where: { userId: actor } })).map((row) => Number(row.amount)),
    ).toEqual([-1, -1]);
  });
  it.each(["legacy", "shadow"] as const)(
    "charges each renewal once while preserving cumulative totals in %s",
    async (selected) => {
      env.security.iamAuthorizationMode = selected;
      const service = RemoteTerminalProductService.getInstance(),
        first = await service.claimPublishedTemplate(body(), actor, request());
      const renewal = { ...body(), targetEntitlementId: first.id };
      await service.claimPublishedTemplate(renewal, actor, request());
      const result = await service.claimPublishedTemplate(renewal, actor, request());
      expect(result.purchaseAmount).toBe(3);
      const account = await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: actor } });
      expect(Number(account.balance)).toBe(97);
      expect(Number(account.totalUsed)).toBe(3);
      expect(
        (await prisma.balanceTransaction.findMany({ where: { userId: actor }, orderBy: { createTime: "asc" } })).map(
          (row) => Number(row.amount),
        ),
      ).toEqual([-1, -1, -1]);
    },
  );
  it.each(["legacy", "shadow"] as const)(
    "does not charge historical purchases for a free renewal in %s",
    async (selected) => {
      env.security.iamAuthorizationMode = selected;
      const service = RemoteTerminalProductService.getInstance(),
        first = await service.claimPublishedTemplate(body(), actor, request());
      await prisma.remoteTerminalProductTemplate.update({ where: { id: template }, data: { devicePrice: 0 } });
      const result = await service.claimPublishedTemplate(
        { ...body(), targetEntitlementId: first.id },
        actor,
        request(),
      );
      expect(result.purchaseAmount).toBe(1);
      expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: actor } })).balance)).toBe(99);
      expect(await prisma.balanceTransaction.count({ where: { userId: actor } })).toBe(1);
    },
  );
  it.each(["legacy", "shadow"] as const)(
    "accepts a balance sufficient for only the current renewal in %s",
    async (selected) => {
      env.security.iamAuthorizationMode = selected;
      const service = RemoteTerminalProductService.getInstance(),
        first = await service.claimPublishedTemplate(body(), actor, request());
      await prisma.balanceAccount.update({ where: { userId: actor }, data: { balance: 1 } });
      const result = await service.claimPublishedTemplate(
        { ...body(), targetEntitlementId: first.id },
        actor,
        request(),
      );
      expect(result.purchaseAmount).toBe(2);
      expect(Number((await prisma.balanceAccount.findUniqueOrThrow({ where: { userId: actor } })).balance)).toBe(0);
      await expect(
        service.claimPublishedTemplate({ ...body(), targetEntitlementId: first.id }, actor, request()),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(
        Number(
          (await prisma.remoteTerminalUserEntitlement.findUniqueOrThrow({ where: { id: first.id } })).purchaseAmount,
        ),
      ).toBe(2);
      expect(await prisma.balanceTransaction.count({ where: { userId: actor } })).toBe(2);
    },
  );
  it("rejects renewal denial before charging", async () => {
    const first = await RemoteTerminalProductService.getInstance().claimPublishedTemplate(body(), actor, request());
    await deny(remoteTerminalProductEntitlementArn(owner, actor, first.id));
    await expect(
      RemoteTerminalProductService.getInstance().claimPublishedTemplate(
        { ...body(), targetEntitlementId: first.id },
        actor,
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(Number((await prisma.balanceAccount.findUnique({ where: { userId: actor } }))!.balance)).toBe(99);
  });
  it("refuses a peer entitlement even inside the same account", async () => {
    const peerTarget = await prisma.remoteTerminalUserEntitlement.create({
      data: {
        userId: peer,
        templateId: template,
        name: "peer fixture",
        startAt: new Date(),
        endAt: new Date(Date.now() + 86400000),
        deviceLimit: 1,
        terminalLimit: 0,
      },
    });
    await expect(prepared(peerTarget.id)).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rejects stale renewal quota snapshots before charging", async () => {
    const first = await RemoteTerminalProductService.getInstance().claimPublishedTemplate(body(), actor, request());
    const source = (await prepared(first.id))!;
    await prisma.$executeRaw`UPDATE remote_terminal_user_entitlements SET deviceLimit=2 WHERE id=${first.id}`;
    await expect(
      repository.purchase(
        {
          kind: "renew",
          chargeAmount: 1,
          entitlement: { name: "unexpected", assignedBy: actor, status: 1, purchaseAmount: 2 },
        },
        source.guard,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(Number((await prisma.balanceAccount.findUnique({ where: { userId: actor } }))!.balance)).toBe(99);
  });
  it("refuses insufficient funds atomically", async () => {
    await prisma.balanceAccount.update({ where: { userId: actor }, data: { balance: 0 } });
    await expect(
      RemoteTerminalProductService.getInstance().claimPublishedTemplate(body(), actor, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.balanceTransaction.count({ where: { userId: actor } })).toBe(0);
    expect(await prisma.remoteTerminalUserEntitlement.count({ where: { userId: actor } })).toBe(0);
  });
});
