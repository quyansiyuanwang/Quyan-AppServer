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
const clear = (channelId = standalone, scope: "all" | "failed" = "all", memberChannelId?: string) =>
  RelayChannelProbeService.getInstance().clearRunHistory(channelId, scope, actor, memberChannelId, request());
async function policy(effect: "Allow" | "Deny", resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:ClearProbeHistory", Resource: resource },
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
  prefix = "probe-clear-" + randomUUID();
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
        permissions: [Permission.RELAY_CHANNEL_PROBE_EXECUTE],
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
describe("probe history removal transaction", () => {
  it("removes terminal runs of the selected channel and preserves active tasks", async () => {
    const active = await prisma.relayChannelProbeRun.create({
      data: { relayChannelId: standalone, requestedByUserId: actor, distributionMultiplier: 1, status: "running" },
    });
    expect(await clear()).toEqual({ deleted: 2 });
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: pool } })).toBe(2);
    expect(await prisma.relayChannelProbeRun.findUnique({ where: { id: active.id } })).not.toBeNull();
  });
  it("limits failed scope to failed timed-out and cancelled runs", async () => {
    await prisma.relayChannelProbeRun.update({ where: { id: latestStandalone }, data: { status: "failed" } });
    expect(await clear(standalone, "failed")).toEqual({ deleted: 1 });
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: standalone } })).toBe(1);
  });
  it("supports the current physical member scope", async () => {
    expect(await clear(pool, "all", member)).toEqual({ deleted: 2 });
    expect(await prisma.relayChannelProbeRun.findUnique({ where: { id: latestMember } })).toBeNull();
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: standalone } })).toBe(2);
  });
  it("requires every run grant and rolls back the whole selection on deny", async () => {
    await policy("Deny", platformRelayProbeRunArn(standalone, latestStandalone));
    await expect(clear()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: standalone } })).toBe(2);
  });
  it.each(["parent", "member"])("requires the %s channel grant", async (kind) => {
    await policy("Deny", platformRelayChannelArn(kind === "parent" ? pool : member));
    await expect(clear(pool)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: pool } })).toBe(2);
  });
  it("rejects forged or moved members before deleting", async () => {
    await expect(clear(pool, "all", outsider)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.relayChannel.update({ where: { id: member }, data: { pooledParentId: null } });
    await expect(clear(pool)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: pool } })).toBe(2);
  });
  it("does not manufacture a platform execute qualification from account grants", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await policy("Allow", "*");
    await expect(clear()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps channel visibility checks for destructive operations", async () => {
    await prisma.relayChannel.update({ where: { id: standalone }, data: { visibilityMode: "private" } });
    await expect(clear()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back an executed deletion when the final grant is revoked", async () => {
    const transaction = prisma.$transaction.bind(prisma),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let deleted = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const remove = tx.relayChannelProbeRun.deleteMany.bind(tx.relayChannelProbeRun);
        vi.spyOn(tx.relayChannelProbeRun, "deleteMany").mockImplementation((args) => {
          deleted = true;
          return remove(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      return deleted ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : rows;
    });
    await expect(clear()).rejects.toMatchObject({ statusCode: 403 });
    expect(deleted).toBe(true);
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: standalone } })).toBe(2);
  });
  it("reads only identifiers and mutation revisions without channel credentials or run details", async () => {
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
    await clear();
    expect(channels.length).toBeGreaterThan(0);
    expect(channels.every((args) => args.select && !args.select.openaiUpstreamApiKey && !args.include)).toBe(true);
    expect(
      runs.every(
        (args) =>
          args.select &&
          Object.keys(args.select).sort().join() === "id,probeMemberChannelId,updateTime" &&
          !args.include,
      ),
    ).toBe(true);
  });
  it.each(["legacy", "shadow"] as const)("preserves the original operation once in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await policy("Deny", platformRelayProbeRunArn(standalone, latestStandalone));
    if (selected === "shadow") {
      const iam = IamAuthorizationService.getInstance(),
        original = iam.authorizeMany.bind(iam);
      vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
        expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: standalone } })).toBe(2);
        return original(input);
      });
    }
    expect(await clear()).toEqual({ deleted: 2 });
  });
  it("returns a safe missing-resource refusal", async () => {
    await expect(clear("missing")).rejects.toMatchObject({ statusCode: 403 });
  });
});
