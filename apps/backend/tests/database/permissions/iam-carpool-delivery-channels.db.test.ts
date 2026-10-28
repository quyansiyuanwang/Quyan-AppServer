import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { CarpoolService } from "@/services/billing/carpool.service";
import { CarpoolRepository } from "@/store/billing/carpool.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { Permission } from "@quyan/shared";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformCarpoolOrderArn } from "@/iam/resources/platform-carpool-resources";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = CarpoolService.getInstance();
let owner: string, actor: string, groupId: string, monthlyId: string, templateId: string, prefix: string, ids: string[];
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const list = (page = 1, pageSize = 20, keyword?: string, orderId?: string) =>
  service.listDeliveryChannels(page, pageSize, keyword, orderId, request());
let channels: string[];
async function deny(id: string, action = "quyan:carpool:ListDeliveryChannels", resource = platformCarpoolOrderArn(id)) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: action, Resource: resource },
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
  prefix = "carpool-read-" + randomUUID();
  ids = [];
  channels = [];
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
        name: "Fixture carpool reader",
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
        salePrice: 10,
        upstreamCost: 5,
        maxMembers: 3,
        monthlyPassTemplateId: monthlyId,
        snapshotQuota: 100,
        snapshotValidityDays: 30,
      },
    })
  ).id;
  for (const [index, state] of ["accepted", "submitted", "open", "cancelled"].entries())
    ids.push(
      (
        await prisma.carpoolOrder.create({
          data: {
            ownerUserId: actor,
            packageTemplateId: templateId,
            monthlyPassTemplateId: monthlyId,
            packageName: prefix,
            salePrice: 10,
            upstreamCost: 5,
            maxMembers: 3,
            totalQuota: 100,
            validityDays: 30,
            state,
            createTime: new Date(Date.UTC(2026, 9, index + 1)),
            submittedAt: index < 2 ? new Date(Date.UTC(2026, 9, index + 1)) : null,
            members: { create: { userId: actor, role: "owner" } },
          },
        })
      ).id,
    );
});
beforeEach(async () => {
  for (const name of ["A", "B", "C"])
    channels.push(
      (await prisma.relayChannel.create({ data: { name: prefix + name, openaiUpstreamApiKey: "fixture-secret" } })).id,
    );
});
afterEach(async () => {
  await prisma.relayChannel.deleteMany({ where: { id: { in: channels } } });
  vi.restoreAllMocks();
  await prisma.carpoolOrder.deleteMany({ where: { packageTemplateId: templateId } });
  await prisma.carpoolPackageTemplate.delete({ where: { id: templateId } });
  await prisma.monthlyPassTemplate.delete({ where: { id: monthlyId } });
  env.security.iamAuthorizationMode = mode;
});
describe("carpool delivery channel reads", () => {
  it("filters denied channels before pagination and counts", async () => {
    await deny(channels[1]!, undefined, "acs:platform:*:platform:relay-channel/" + channels[1]);
    const legacy = vi.spyOn(CarpoolRepository.getInstance(), "listEligibleDeliveryChannels");
    expect(await list(1, 1, prefix)).toMatchObject({ total: 2, records: [{ id: channels[0] }] });
    expect(await list(2, 1, prefix)).toMatchObject({ total: 2, records: [{ id: channels[2] }] });
    expect(legacy).not.toHaveBeenCalled();
    expect(JSON.stringify(await list(1, 20, prefix))).not.toContain("fixture-secret");
  });
  it("reads only identity for denied channels and never selects upstream credentials", async () => {
    await deny(channels[0]!, undefined, "acs:platform:*:platform:relay-channel/" + channels[0]);
    const transaction = prisma.$transaction.bind(prisma),
      reads: Prisma.RelayChannelFindFirstArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const find = tx.relayChannel.findFirst.bind(tx.relayChannel);
        vi.spyOn(tx.relayChannel, "findFirst").mockImplementation((args) => {
          if (args) reads.push(args);
          return find(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await list(1, 20, prefix);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.some((args) => args.where?.id === channels[0])).toBe(false);
    expect(
      reads.every(
        (args) =>
          args.select &&
          Object.keys(args.select).every((key) => ["id", "name", "channelType", "updateTime"].includes(key)),
      ),
    ).toBe(true);
  });
  it("honors the accepted order snapshot and rejects denied source orders", async () => {
    await prisma.carpoolOrder.update({
      where: { id: ids[0] },
      data: { allowedChannels: JSON.stringify([channels[2]]) },
    });
    expect(await list(1, 20, prefix, ids[0])).toMatchObject({ total: 1, records: [{ id: channels[2] }] });
    await deny(ids[0]!);
    await expect(list(1, 20, prefix, ids[0])).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects unaccepted source orders", async () => {
    await expect(list(1, 20, prefix, ids[1])).rejects.toMatchObject({ statusCode: 400 });
  });
  it("excludes disabled pending and provider-disabled channels", async () => {
    await prisma.relayChannel.update({ where: { id: channels[0] }, data: { status: 0 } });
    await prisma.relayChannel.update({ where: { id: channels[1] }, data: { submissionStatus: "pending" } });
    await prisma.relayChannel.update({ where: { id: channels[2] }, data: { providerServiceEnabled: false } });
    expect(await list(1, 20, prefix)).toEqual({ total: 0, records: [] });
  });
  it("requires global fulfillment qualification", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(list(1, 20, prefix)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed when a contributing decision changes before response", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const results = await original(input);
      count++;
      return count > 1 ? results.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : results;
    });
    await expect(list(1, 20, prefix)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("preserves legacy response in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await deny(channels[0]!, undefined, "acs:platform:*:platform:relay-channel/" + channels[0]);
    expect(await list(1, 20, prefix)).toMatchObject({ total: 3 });
  });
});
