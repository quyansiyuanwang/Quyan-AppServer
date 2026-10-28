import { platformMonthlyPassArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { CarpoolService } from "@/services/billing/carpool.service";
import { CarpoolRepository } from "@/store/billing/carpool.repository";
import { PlatformCarpoolOrderDeliveryIamService } from "@/services/billing/platform-carpool-order-delivery-iam.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { Permission } from "@quyan/shared";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformCarpoolOrderArn, platformCarpoolDeliveryTokenArn } from "@/iam/resources/platform-carpool-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = CarpoolService.getInstance(),
  authority = PlatformCarpoolOrderDeliveryIamService.getInstance();
let owner: string,
  actor: string,
  groupId: string,
  monthlyId: string,
  templateId: string,
  orderId: string,
  prefix: string,
  payers: string[],
  channelId: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const fulfill = () => service.fulfill(orderId, channelId, actor, request());
const prepared = () => authority.prepare(actor, request(), orderId, channelId);
async function deny(resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:carpool:FulfillOrder", Resource: resource },
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
  prefix = "carpool-delivery-" + randomUUID();
  payers = [];
  channelId = (await prisma.relayChannel.create({ data: { name: prefix, openaiUpstreamApiKey: "fixture-secret" } })).id;
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
  payers.push(await user(), await user());
  groupId = (
    await prisma.group.create({
      data: {
        username: prefix,
        name: "Fixture refund manager",
        accountOwnerId: null,
        permissions: [Permission.CARPOOL_ORDER_FULFILL],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  monthlyId = (await prisma.monthlyPassTemplate.create({ data: { name: prefix, defaultQuota: 100 } })).id;
  templateId = (
    await prisma.carpoolPackageTemplate.create({
      data: {
        name: prefix,
        salePrice: 20,
        upstreamCost: 10,
        maxMembers: 3,
        monthlyPassTemplateId: monthlyId,
        snapshotQuota: 100,
        snapshotValidityDays: 30,
      },
    })
  ).id;
  orderId = (
    await prisma.carpoolOrder.create({
      data: {
        ownerUserId: payers[0]!,
        packageTemplateId: templateId,
        monthlyPassTemplateId: monthlyId,
        packageName: prefix,
        salePrice: 20,
        upstreamCost: 10,
        maxMembers: 3,
        totalQuota: 100,
        validityDays: 30,
        state: "accepted",
      },
    })
  ).id;
  for (const userId of payers) {
    await prisma.carpoolMember.create({
      data: { orderId, userId, state: "confirmed", payableAmount: 10, finalQuota: 50 },
    });
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.relayToken.deleteMany({ where: { userId: { in: payers }, name: "Carpool " + prefix } });
  await prisma.userMonthlyPass.deleteMany({ where: { userId: { in: payers }, templateId: monthlyId } });
  await prisma.carpoolOrder.delete({ where: { id: orderId } });
  await prisma.relayChannel.delete({ where: { id: channelId } });
  await prisma.carpoolPackageTemplate.delete({ where: { id: templateId } });
  await prisma.monthlyPassTemplate.delete({ where: { id: monthlyId } });
  env.security.iamAuthorizationMode = mode;
});
async function unchanged() {
  expect((await prisma.carpoolOrder.findUniqueOrThrow({ where: { id: orderId } })).state).toBe("accepted");
  expect(await prisma.carpoolOrderEvent.count({ where: { orderId } })).toBe(0);
  expect(await prisma.userMonthlyPass.count({ where: { userId: { in: payers }, templateId: monthlyId } })).toBe(0);
  expect(await prisma.relayToken.count({ where: { userId: { in: payers } } })).toBe(0);
  expect(await prisma.carpoolMember.count({ where: { orderId, state: "confirmed", userMonthlyPassId: null } })).toBe(2);
}
describe("carpool delivery resource guards", () => {
  it("commits each recipient's snapshot entitlements, state and event together without exposing credentials", async () => {
    const result = await fulfill();
    expect(result).toMatchObject({ id: orderId, state: "fulfilled", relayChannelId: channelId });
    expect(JSON.stringify(result)).not.toContain("sk-rlt-");
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    for (const userId of payers) {
      const pass = await prisma.userMonthlyPass.findFirstOrThrow({ where: { userId, templateId: monthlyId } });
      expect(Number(pass.totalQuota)).toBe(50);
      expect(Number(pass.remainingQuota)).toBe(50);
      expect(pass.endAt.getTime() - pass.startAt.getTime()).toBe(30 * 86400000);
      const token = await prisma.relayToken.findFirstOrThrow({
        where: { userId },
        select: { quotaLimit: true, channelId: true },
      });
      expect(Number(token.quotaLimit)).toBe(50);
      expect(token.channelId).toBe(channelId);
    }
    expect(await prisma.carpoolOrderEvent.count({ where: { orderId, type: "fulfilled" } })).toBe(1);
  });
  it.each(["order", "channel", "package", "template", "recipient", "pass", "token"])(
    "rolls back every recipient when %s is denied",
    async (kind) => {
      const resources: Record<string, string> = {
        order: platformCarpoolOrderArn(orderId),
        channel: platformRelayChannelArn(channelId),
        package: platformTemplateArn("carpool", templateId),
        template: platformTemplateArn("monthly-pass", monthlyId),
        recipient: platformUserArn(payers[1]!),
        pass: platformMonthlyPassArn(payers[1]!, "new").replace(/new$/, "*"),
        token: platformCarpoolDeliveryTokenArn(payers[1]!, "new").replace(/new$/, "*"),
      };
      await deny(resources[kind]!);
      await expect(fulfill()).rejects.toMatchObject({ statusCode: 403 });
      await unchanged();
    },
  );
  it("preserves delivery from disabled and unpublished templates with the original quota snapshot", async () => {
    await prisma.monthlyPassTemplate.update({
      where: { id: monthlyId },
      data: { status: 0, publishStatus: "draft", defaultQuota: 999 },
    });
    await prisma.carpoolPackageTemplate.update({
      where: { id: templateId },
      data: { status: 0, publishStatus: "draft", snapshotQuota: 999 },
    });
    await fulfill();
    expect(Number((await prisma.userMonthlyPass.findFirstOrThrow({ where: { userId: payers[0] } })).totalQuota)).toBe(
      50,
    );
  });
  it("retains stored decimal precision for passes and Relay token quotas", async () => {
    await prisma.carpoolMember.updateMany({ where: { orderId }, data: { finalQuota: 33.3333 } });
    await fulfill();
    expect(Number((await prisma.userMonthlyPass.findFirstOrThrow({ where: { userId: payers[0] } })).totalQuota)).toBe(
      33.3333,
    );
    expect(
      Number(
        (await prisma.relayToken.findFirstOrThrow({ where: { userId: payers[0] }, select: { quotaLimit: true } }))
          .quotaLimit,
      ),
    ).toBe(33.33);
  });
  it("rejects changed snapshots and moved recipients even with unchanged timestamps", async () => {
    const guard = await prepared();
    const member = guard!.target.record.members[0]!;
    await prisma.carpoolMember.update({
      where: { id: member.id },
      data: { finalQuota: 99, updateTime: member.updateTime },
    });
    await expect(
      CarpoolRepository.getInstance().withDeliveryTransaction(guard!, async () => ({ id: orderId })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rejects moved recipients after preparation", async () => {
    const guard = await prepared(),
      customer = guard!.customers[0]!;
    await prisma.user.update({
      where: { id: customer.id },
      data: { accountOwnerId: owner, updateTime: customer.updateTime },
    });
    await expect(
      CarpoolRepository.getInstance().withDeliveryTransaction(guard!, async () => ({ id: orderId })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it.each(["pass", "recipient", "token"])("rejects modified generated %s terms before committing", async (kind) => {
    const repository = CarpoolRepository.getInstance(),
      original = repository.withDeliveryTransaction.bind(repository);
    vi.spyOn(repository, "withDeliveryTransaction").mockImplementation((guard, callback) =>
      original(guard, async (tx) => {
        const result = await callback(tx),
          entry = guard.deliveries[0]!;
        if (kind === "token")
          await tx.relayToken.update({
            where: { id: entry.tokenId },
            data: { allowedModels: "different-model" },
            select: { id: true },
          });
        else
          await tx.userMonthlyPass.update({
            where: { id: entry.passId },
            data: kind === "recipient" ? { userId: actor } : { totalQuota: 999 },
          });
        return result;
      }),
    );
    await expect(fulfill()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("excludes departed members from every generated entitlement", async () => {
    await prisma.carpoolMember.updateMany({ where: { orderId, userId: payers[1] }, data: { state: "left" } });
    await fulfill();
    expect(await prisma.userMonthlyPass.count({ where: { userId: payers[0] } })).toBe(1);
    expect(await prisma.userMonthlyPass.count({ where: { userId: payers[1] } })).toBe(0);
    expect(await prisma.relayToken.count({ where: { userId: payers[1] } })).toBe(0);
  });
  it("rolls back all generated resources on the final authorization check", async () => {
    const original = authority.prepare.bind(authority);
    vi.spyOn(authority, "prepare").mockImplementation(async (...args) => {
      const guard = await original(...args),
        check = guard!.users.recheck;
      guard!.users.recheck = async () => {
        await check();
        if (guard!.deliveries.length === 2) throw iamAccountDenied();
      };
      return guard;
    });
    await expect(fulfill()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rejects revoked authority and removed global management qualification", async () => {
    const guard = await prepared();
    await deny(platformCarpoolOrderArn(orderId));
    await expect(
      CarpoolRepository.getInstance().withDeliveryTransaction(guard!, async () => ({ id: orderId })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(fulfill()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rechecks channel eligibility and order channel snapshots", async () => {
    await prisma.relayChannel.update({ where: { id: channelId }, data: { submissionStatus: "pending" } });
    await expect(fulfill()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
    await prisma.relayChannel.update({ where: { id: channelId }, data: { submissionStatus: "approved" } });
    await prisma.carpoolOrder.update({ where: { id: orderId }, data: { allowedChannels: '["different-channel"]' } });
    await expect(fulfill()).rejects.toMatchObject({ statusCode: 400 });
    await unchanged();
  });
  it("allows one concurrent delivery", async () => {
    const results = await Promise.allSettled([fulfill(), fulfill()]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.userMonthlyPass.count({ where: { userId: { in: payers } } })).toBe(2);
    expect(await prisma.relayToken.count({ where: { userId: { in: payers } } })).toBe(2);
    expect(await prisma.carpoolOrderEvent.count({ where: { orderId, type: "fulfilled" } })).toBe(1);
  });
  it("uses legacy source fallback only when the order has no template snapshot", async () => {
    await prisma.carpoolOrder.update({ where: { id: orderId }, data: { monthlyPassTemplateId: null } });
    await fulfill();
    expect(await prisma.userMonthlyPass.count({ where: { userId: { in: payers }, templateId: monthlyId } })).toBe(2);
  });
  it("requires native Allow and a valid request context", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockResolvedValue([]);
    await expect(fulfill()).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.fulfill(orderId, channelId, actor)).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
});
