import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformRelayProbeRunArn } from "@/iam/resources/platform-relay-probe-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, groupId: string, prefix: string;
let standalone: string, pool: string, member: string, outsider: string;
let channelIds: string[], latestStandalone: string, latestMember: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const history = (channelId = standalone, page = 1, pageSize = 20, memberChannelId?: string) =>
  RelayChannelProbeService.getInstance().listRuns(channelId, actor, page, pageSize, memberChannelId, request());
async function policy(effect: "Allow" | "Deny", resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:ListProbeRuns", Resource: resource },
  });
  const created = await RamPolicyRepository.getInstance().createPolicy({
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
      policyId: created.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "probe-history-" + randomUUID();
  channelIds = [];
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
        name: "Fixture probe reader",
        accountOwnerId: null,
        permissions: [Permission.RELAY_CHANNEL_PROBE_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  const channel = async (data: Partial<Prisma.RelayChannelUncheckedCreateInput> = {}) => {
    const row = await prisma.relayChannel.create({
      data: { name: prefix, openaiUpstreamApiKey: "fixture-private-upstream", ...data },
    });
    channelIds.push(row.id);
    return row.id;
  };
  standalone = await channel();
  pool = await channel({ channelType: "pooled" });
  member = await channel({ pooledParentId: pool });
  outsider = await channel();
  const run = async (channelId: string, memberId: string | null, time: number) =>
    (
      await prisma.relayChannelProbeRun.create({
        data: {
          relayChannelId: channelId,
          probeMemberChannelId: memberId,
          requestedByUserId: actor,
          distributionMultiplier: 1,
          status: "succeeded",
          createTime: new Date(time),
          leaseOwner: "fixture-worker-lease",
        },
      })
    ).id;
  await run(standalone, null, 1000);
  latestStandalone = await run(standalone, null, 2000);
  await run(pool, member, 1000);
  latestMember = await run(pool, member, 2000);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayChannelProbeRun.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannelMember.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannel.updateMany({ where: { id: { in: channelIds } }, data: { pooledParentId: null } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: channelIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("probe history resource filtering and pagination", () => {
  it.each([
    [0, 20],
    [1, 101],
    [10001, 20],
  ])("rejects invalid page %s and size %s before reading", async (page, pageSize) => {
    await expect(history(standalone, page, pageSize)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("pages after authorization and counts only allowed records", async () => {
    await policy("Deny", platformRelayProbeRunArn(standalone, latestStandalone));
    const first = await history(standalone, 1, 1),
      second = await history(standalone, 2, 1);
    expect(first.total).toBe(1);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.id).not.toBe(latestStandalone);
    expect(second).toEqual({ items: [], total: 1, page: 2, pageSize: 1 });
  });
  it("retains descending time and deterministic id order", async () => {
    const result = await history();
    expect(result.total).toBe(2);
    expect(result.items[0]?.id).toBe(latestStandalone);
    expect((await history(standalone, 2, 1)).items[0]?.id).toBe(result.items[1]?.id);
  });
  it("returns the current physical member's history", async () => {
    const result = await history(pool, 1, 20, member);
    expect(result.total).toBe(2);
    expect(result.items[0]?.id).toBe(latestMember);
  });
  it("requires parent and explicit member access before reading history", async () => {
    await policy("Deny", platformRelayChannelArn(member));
    await expect(history(pool, 1, 20, member)).rejects.toMatchObject({ statusCode: 403 });
    expect(await history(pool)).toMatchObject({ items: [], total: 0 });
    await policy("Deny", platformRelayChannelArn(standalone));
    await expect(history()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never exposes history of moved or forged physical members", async () => {
    await expect(history(pool, 1, 20, outsider)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.relayChannel.update({ where: { id: member }, data: { pooledParentId: null } });
    expect(await history(pool)).toMatchObject({ items: [], total: 0 });
  });
  it("strict children supersede legacy edges", async () => {
    await prisma.relayChannelMember.create({ data: { relayChannelId: pool, memberChannelId: outsider, priority: 0 } });
    await expect(history(pool, 1, 20, outsider)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.relayChannel.update({ where: { id: member }, data: { pooledParentId: null } });
    expect(await history(pool, 1, 20, outsider)).toMatchObject({ items: [], total: 0 });
  });
  it("requires deployment qualification independently of account grants", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await policy("Allow", "*");
    await expect(history()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["private", "hidden"])("keeps %s visibility checks", async (visibilityMode) => {
    await prisma.relayChannel.update({ where: { id: standalone }, data: { visibilityMode } });
    await expect(history()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks contributing decisions before returning a page", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      return ++count > 2 ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : rows;
    });
    await expect(history()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("reads no channel credentials and hydrates only the authorized page", async () => {
    await policy("Deny", platformRelayProbeRunArn(standalone, latestStandalone));
    const transaction = prisma.$transaction.bind(prisma),
      channels: Prisma.RelayChannelFindFirstArgs[] = [],
      runs: Prisma.RelayChannelProbeRunFindManyArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const channelRead = tx.relayChannel.findFirst.bind(tx.relayChannel),
          runRead = tx.relayChannelProbeRun.findMany.bind(tx.relayChannelProbeRun);
        vi.spyOn(tx.relayChannel, "findFirst").mockImplementation((args) => {
          if (args) channels.push(args);
          return channelRead(args);
        });
        vi.spyOn(tx.relayChannelProbeRun, "findMany").mockImplementation((args) => {
          if (args) runs.push(args);
          return runRead(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const result = await history(standalone, 1, 1);
    expect(channels.every((args) => args.select && !args.select.openaiUpstreamApiKey && !args.include)).toBe(true);
    expect(
      runs.every((args) => args.select && !args.select.leaseOwner && !args.select.appliedByUserId && !args.include),
    ).toBe(true);
    expect(runs.find((args) => args.select?.status)?.where?.id).toEqual({ in: result.items.map((row) => row.id) });
  });
  it.each(["legacy", "shadow"] as const)("retains legacy output in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await policy("Deny", platformRelayProbeRunArn(standalone, latestStandalone));
    expect((await history()).items[0]?.id).toBe(latestStandalone);
  });
  it("scans metadata across decision batches before counting a page", async () => {
    await prisma.relayChannelProbeRun.createMany({
      data: Array.from({ length: 501 }, (_row, index) => ({
        relayChannelId: standalone,
        requestedByUserId: actor,
        distributionMultiplier: 1,
        createTime: new Date(3000 + index),
      })),
    });
    const page = await history(standalone, 6, 100);
    expect(page.total).toBe(503);
    expect(page.items).toHaveLength(3);
  });
});
