import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { Permission, RELAY_CHANNEL_STATUS } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import type { RelayChannelManagementFilters } from "@/store/relay/relay-channel-management-query";
const mode = env.security.iamAuthorizationMode,
  service = RelayChannelService.getInstance();
let owner: string,
  actor: string,
  groupId: string,
  prefix: string,
  root: string,
  leaf: string,
  deniedLeaf: string,
  modelIds: string[];
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const list = (query: RelayChannelManagementFilters = {}) =>
  service.listManagementChannels(actor, { keyword: prefix, ...query }, request());
async function deny(resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Deny", Action: "quyan:relay:ListManagementChannels", Resource: resource },
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
  prefix = "iam-relay-management-" + randomUUID();
  modelIds = [];
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
        name: "Fixture channel manager",
        accountOwnerId: null,
        permissions: [Permission.RELAY_CHANNEL_READ, Permission.RELAY_CHANNEL_REVIEW],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  root = (
    await prisma.relayChannel.create({
      data: {
        name: prefix + "-root",
        channelType: "pooled",
        openaiUpstreamApiKey: "fixture-secret",
        routingConfig: { allowedModelsMode: "all" },
        createTime: new Date("2026-10-15T00:00:00Z"),
      },
    })
  ).id;
  leaf = (
    await prisma.relayChannel.create({
      data: {
        name: prefix + "-leaf",
        channelType: "pooled-member",
        pooledParentId: root,
        pooledMemberEnabled: true,
        allowedFormats: "openai",
        allowedModels: JSON.stringify([prefix + "-alpha"]),
        routingConfig: { allowedModelsMode: "manual" },
        createTime: new Date("2026-10-14T00:00:00Z"),
      },
    })
  ).id;
  deniedLeaf = (
    await prisma.relayChannel.create({
      data: {
        name: prefix + "-denied",
        allowedFormats: "openai",
        allowedModels: JSON.stringify([prefix + "-beta"]),
        routingConfig: { allowedModelsMode: "manual" },
        openaiUpstreamApiKey: "fixture-secret",
        createTime: new Date("2026-10-13T00:00:00Z"),
      },
    })
  ).id;
  await prisma.relayChannelMember.createMany({
    data: [
      { relayChannelId: root, memberChannelId: leaf, priority: 0, enabled: false },
      { relayChannelId: root, memberChannelId: deniedLeaf, priority: 1, enabled: true },
    ],
  });
  for (const suffix of ["alpha", "beta"])
    modelIds.push(
      (
        await prisma.modelPricing.create({
          data: {
            model: prefix + "-" + suffix,
            provider: prefix + "-" + suffix,
            supportedFormats: "openai",
            pricingType: "token-based",
            inputPrice: 1,
            outputPrice: 1,
          },
        })
      ).id,
    );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.relayChannel.deleteMany({ where: { id: { in: [root, leaf, deniedLeaf] } } });
  await prisma.modelPricing.deleteMany({ where: { id: { in: modelIds } } });
  env.security.iamAuthorizationMode = mode;
});
describe("Relay management resource collection", () => {
  it("filters before pagination and counts without using the legacy page query", async () => {
    await deny(platformRelayChannelArn(deniedLeaf));
    const legacy = vi.spyOn(RelayChannelRepository.getInstance(), "listManagementPage");
    expect(await list({ page: 1, pageSize: 1 })).toMatchObject({ total: 2, items: [{ id: root, poolMemberCount: 1 }] });
    expect(await list({ page: 2, pageSize: 1 })).toMatchObject({
      total: 2,
      items: [{ id: leaf, pooledParentId: root }],
    });
    expect(legacy).not.toHaveBeenCalled();
    expect(JSON.stringify(await list())).not.toContain("fixture-secret");
  });
  it("hides a denied parent and its name while retaining permitted child records", async () => {
    await deny(platformRelayChannelArn(root));
    const result = await list();
    expect(result.total).toBe(2);
    const child = result.items.find((item) => item.id === leaf);
    expect(child?.pooledParentId).toBeUndefined();
    expect(child?.pooledParentName).toBeUndefined();
  });
  it("filters models through admitted paths and preserves strict-child precedence over legacy edges", async () => {
    await deny(platformRelayChannelArn(deniedLeaf));
    expect(await list({ keyword: prefix + "-root", models: [prefix + "-alpha"] })).toMatchObject({
      total: 1,
      items: [{ id: root }],
    });
    expect(await list({ keyword: prefix + "-root", models: [prefix + "-beta"] })).toMatchObject({
      total: 0,
      items: [],
    });
    expect(
      await list({ keyword: prefix + "-root", models: [prefix + "-alpha", prefix + "-beta"], modelMatchMode: "all" }),
    ).toMatchObject({ total: 0, items: [] });
  });
  it("respects channel type, enabled and pending-review filters", async () => {
    await prisma.relayChannel.update({
      where: { id: deniedLeaf },
      data: { status: RELAY_CHANNEL_STATUS.DISABLED, submissionStatus: "pending" },
    });
    expect(await list({ enabled: false })).toMatchObject({ total: 1, items: [{ id: deniedLeaf, enabled: false }] });
    expect(await list({ channelTypes: ["pooled", "pooled-member"] })).toMatchObject({ total: 2 });
    expect(await list({ submissionStatus: "pending" })).toMatchObject({ total: 1, items: [{ id: deniedLeaf }] });
  });
  it("loads only safe projections and never hydrates a denied channel", async () => {
    await deny(platformRelayChannelArn(deniedLeaf));
    const transaction = prisma.$transaction.bind(prisma),
      reads: Prisma.RelayChannelFindManyArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const find = tx.relayChannel.findMany.bind(tx.relayChannel);
        vi.spyOn(tx.relayChannel, "findMany").mockImplementation((args) => {
          if (args) reads.push(args);
          return find(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await list({ models: [prefix + "-alpha"] });
    const projected = reads.filter((args) => args.select?.name);
    expect(projected.length).toBeGreaterThan(0);
    expect(
      projected.every(
        (args) =>
          !args.select?.openaiUpstreamApiKey &&
          !args.select?.anthropicUpstreamApiKey &&
          !args.select?.geminiUpstreamApiKey,
      ),
    ).toBe(true);
    expect(projected.every((args) => !JSON.stringify(args.where).includes(deniedLeaf))).toBe(true);
  });
  it("requires deployment qualification and native Allow and rechecks contributing decisions", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: null } });
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      return ++count > 1 ? result.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : result;
    });
    await expect(list()).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    vi.spyOn(iam, "loadPolicies").mockResolvedValue([]);
    expect(await list()).toMatchObject({ total: 0, items: [] });
  });
  it.each(["legacy", "shadow"] as const)("retains legacy counts in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await deny(platformRelayChannelArn(deniedLeaf));
    expect(await list()).toMatchObject({ total: 3 });
  });
});
