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
const latest = (targets = [{ channelId: pool, memberChannelId: member }, { channelId: standalone }]) =>
  RelayChannelProbeService.getInstance().listLatestRuns({ targets }, actor, request());
async function policy(effect: "Allow" | "Deny", resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:ListLatestProbeRuns", Resource: resource },
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
  prefix = "probe-latest-" + randomUUID();
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
describe("latest probe result resource authorization", () => {
  it("returns only the newest exact target and preserves request ordering", async () => {
    const result = await latest();
    expect(result.map((row) => row.latestRun?.id)).toEqual([latestMember, latestStandalone]);
    expect(result.map((row) => row.channelId)).toEqual([pool, standalone]);
    expect(JSON.stringify(result)).not.toContain("fixture-private-upstream");
    expect(JSON.stringify(result)).not.toContain("fixture-worker-lease");
  });
  it.each(["parent", "member"])("excludes a denied %s before loading run details", async (kind) => {
    await policy("Deny", platformRelayChannelArn(kind === "parent" ? pool : member));
    expect((await latest()).map((row) => row.channelId)).toEqual([standalone]);
  });
  it("does not fall back to an older run when the newest is denied", async () => {
    await policy("Deny", platformRelayProbeRunArn(standalone, latestStandalone));
    const result = await latest();
    expect(result[0]?.latestRun?.id).toBe(latestMember);
    expect(result[1]).toEqual({ channelId: standalone });
  });
  it("returns no targets for an all-resource deny", async () => {
    await policy("Deny", "*");
    expect(await latest()).toEqual([]);
  });
  it("rejects nonexistent channels and forged member relationships", async () => {
    await expect(latest([{ channelId: "missing" }])).rejects.toMatchObject({ statusCode: 403 });
    await expect(latest([{ channelId: pool, memberChannelId: outsider }])).rejects.toMatchObject({ statusCode: 403 });
    await expect(latest([{ channelId: standalone, memberChannelId: member }])).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("uses strict children before legacy edges and permits legacy membership without strict children", async () => {
    await prisma.relayChannelMember.create({ data: { relayChannelId: pool, memberChannelId: outsider, priority: 0 } });
    await expect(latest([{ channelId: pool, memberChannelId: outsider }])).rejects.toMatchObject({ statusCode: 403 });
    await prisma.relayChannel.update({ where: { id: member }, data: { pooledParentId: null } });
    expect(await latest([{ channelId: pool, memberChannelId: outsider }])).toEqual([
      { channelId: pool, memberChannelId: outsider },
    ]);
  });
  it.each(["private", "hidden"])("retains %s channel visibility restrictions", async (visibilityMode) => {
    await prisma.relayChannel.update({ where: { id: standalone }, data: { visibilityMode } });
    await expect(latest([{ channelId: standalone }])).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.RELAY_CHANNEL_PROBE_READ, Permission.RELAY_CHANNEL_UPDATE] },
    });
    expect((await latest([{ channelId: standalone }]))[0]?.latestRun?.id).toBe(latestStandalone);
  });
  it("retains whitelist access", async () => {
    await prisma.relayChannel.update({
      where: { id: standalone },
      data: { visibilityMode: "whitelist", visibilityConfig: { userIds: [actor] } },
    });
    expect((await latest([{ channelId: standalone }]))[0]?.latestRun?.id).toBe(latestStandalone);
    await prisma.relayChannel.update({ where: { id: standalone }, data: { visibilityConfig: { userIds: [owner] } } });
    await expect(latest([{ channelId: standalone }])).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not manufacture platform qualification from account grants", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await policy("Allow", "*");
    await expect(latest()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed when a resource decision changes before response", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      count++;
      return count > 2 ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : rows;
    });
    await expect(latest()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("selects channel metadata and only authorized public run fields", async () => {
    await policy("Deny", platformRelayProbeRunArn(standalone, latestStandalone));
    const transaction = prisma.$transaction.bind(prisma),
      channelReads: Prisma.RelayChannelFindManyArgs[] = [],
      runReads: Prisma.RelayChannelProbeRunFindManyArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const channels = tx.relayChannel.findMany.bind(tx.relayChannel),
          runs = tx.relayChannelProbeRun.findMany.bind(tx.relayChannelProbeRun);
        vi.spyOn(tx.relayChannel, "findMany").mockImplementation((args) => {
          if (args) channelReads.push(args);
          return channels(args);
        });
        vi.spyOn(tx.relayChannelProbeRun, "findMany").mockImplementation((args) => {
          if (args) runReads.push(args);
          return runs(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await latest();
    expect(channelReads.length).toBeGreaterThan(0);
    expect(channelReads.every((args) => args.select && !args.select.openaiUpstreamApiKey && !args.include)).toBe(true);
    expect(
      runReads.every(
        (args) =>
          args.select &&
          !args.select.leaseOwner &&
          !args.select.leaseExpiresAt &&
          !args.select.appliedByUserId &&
          !args.include,
      ),
    ).toBe(true);
    expect(runReads.find((args) => args.select?.status)?.where?.id).toEqual({ in: [latestMember] });
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves legacy results and permission enforcement in %s",
    async (selected) => {
      env.security.iamAuthorizationMode = selected;
      await policy("Deny", platformRelayProbeRunArn(standalone, latestStandalone));
      expect((await latest()).map((row) => row.latestRun?.id)).toEqual([latestMember, latestStandalone]);
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      await expect(latest()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
});
