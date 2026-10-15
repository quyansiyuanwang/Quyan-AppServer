import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { RedisService } from "@/services/infrastructure/redis.service";
import { RelayChannelProbeLockService } from "@/services/relay/relay-channel-probe-lock.service";
import { relayProbeQueueSlotKey, RELAY_PROBE_QUEUE_POLICY } from "@/services/relay/relay-channel-probe-queue-policy";
import {
  platformRelayProbeRunArn,
  platformRelayProbeQueueSlotArn,
} from "@/iam/resources/platform-relay-probe-resources";
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
const reset = (channelId = standalone, memberChannelId?: string) =>
  RelayChannelProbeService.getInstance().resetRunState(channelId, actor, memberChannelId, request());
const redis = () => RedisService.getInstance();
const slot = (channelId = standalone, memberChannelId?: string) => relayProbeQueueSlotKey(channelId, memberChannelId);
const reserve = (channelId: string, memberChannelId: string | undefined, value: string) =>
  redis().set(slot(channelId, memberChannelId), value, RELAY_PROBE_QUEUE_POLICY.slotTtlMs / 1000);
async function policy(effect: "Allow" | "Deny", resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:ResetProbeRuns", Resource: resource },
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
  prefix = "probe-reset-" + randomUUID();
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
  await prisma.relayChannelProbeRun.updateMany({
    where: { id: { in: [latestStandalone, latestMember] } },
    data: { status: "queued" },
  });
  await reserve(standalone, undefined, latestStandalone);
  await reserve(pool, member, latestMember);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await Promise.all(
    channelIds.flatMap((id) => [undefined, ...channelIds].map((memberId) => redis().delete(slot(id, memberId)))),
  );
  await prisma.relayChannelProbeRun.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannelMember.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannel.updateMany({ where: { id: { in: channelIds } }, data: { pooledParentId: null } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: channelIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("probe reset resource authorization and queue coordination", () => {
  it("cancels only active runs and releases their exact queue values", async () => {
    await reset();
    const run = await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: latestStandalone } });
    expect(run).toMatchObject({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null });
    expect(await redis().get(slot())).toBeNull();
    expect(
      await prisma.relayChannelProbeRun.count({ where: { relayChannelId: standalone, status: "succeeded" } }),
    ).toBe(1);
    expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: latestMember } })).status).toBe(
      "queued",
    );
  });
  it("whole-pool reset releases member slots as well as the parent slot", async () => {
    await reserve(pool, undefined, randomUUID());
    await reset(pool);
    expect(await redis().get(slot(pool))).toBeNull();
    expect(await redis().get(slot(pool, member))).toBeNull();
    expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: latestMember } })).status).toBe(
      "cancelled",
    );
  });
  it("selected-member reset preserves other members and the parent reservation", async () => {
    await reserve(pool, undefined, randomUUID());
    await reset(pool, member);
    expect(await redis().get(slot(pool))).not.toBeNull();
    expect(await redis().get(slot(pool, member))).toBeNull();
    expect(await redis().get(slot())).toBe(latestStandalone);
  });
  it("scans and authorizes more than one batch of active runs before cancellation", async () => {
    const ids = Array.from({ length: 501 }, () => randomUUID());
    await prisma.relayChannelProbeRun.createMany({
      data: ids.map((id) => ({
        id,
        relayChannelId: standalone,
        requestedByUserId: actor,
        distributionMultiplier: 1,
        status: "queued",
      })),
    });
    await reset();
    expect(
      await prisma.relayChannelProbeRun.count({ where: { relayChannelId: standalone, status: "cancelled" } }),
    ).toBe(502);
    expect(await prisma.relayChannelProbeRun.count({ where: { relayChannelId: standalone, status: "queued" } })).toBe(
      0,
    );
  });
  it("serializes a new reservation after reset rather than deleting it", async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      finish = new Promise<void>((resolve) => {
        release = resolve;
      });
    const original = redis().getWithResult.bind(redis()),
      newer = randomUUID();
    vi.spyOn(redis(), "getWithResult").mockImplementation(async (key) => {
      const result = await original(key);
      if (key === slot()) {
        entered();
        await finish;
      }
      return result;
    });
    const resetting = reset();
    await started;
    let created = false;
    const creating = RelayChannelProbeLockService.getInstance().withQueueWrite(standalone, async () => {
      created = true;
      await reserve(standalone, undefined, newer);
    });
    try {
      expect(created).toBe(false);
    } finally {
      release();
    }
    await Promise.all([resetting, creating]);
    expect(await redis().get(slot())).toBe(newer);
  });
  it("requires the selected channel, member and every active run grant", async () => {
    await policy("Deny", platformRelayProbeRunArn(pool, latestMember));
    await expect(reset(pool)).rejects.toMatchObject({ statusCode: 403 });
    expect(await redis().get(slot(pool, member))).toBe(latestMember);
    expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: latestMember } })).status).toBe(
      "queued",
    );
  });
  it("requires the exact queue-slot grant even if no run is persisted", async () => {
    const reservation = randomUUID();
    await reserve(outsider, undefined, reservation);
    await policy("Deny", platformRelayProbeQueueSlotArn(outsider));
    await expect(reset(outsider)).rejects.toMatchObject({ statusCode: 403 });
    expect(await redis().get(slot(outsider))).toBe(reservation);
  });
  it("clears an authorized orphan UUID reservation", async () => {
    await reserve(outsider, undefined, randomUUID());
    await reset(outsider);
    expect(await redis().get(slot(outsider))).toBeNull();
  });
  it("checks a terminal run referenced by a stale queue slot", async () => {
    await prisma.relayChannelProbeRun.update({ where: { id: latestStandalone }, data: { status: "succeeded" } });
    await policy("Deny", platformRelayProbeRunArn(standalone, latestStandalone));
    await expect(reset()).rejects.toMatchObject({ statusCode: 403 });
    expect(await redis().get(slot())).toBe(latestStandalone);
  });
  it("refuses a queue value referring to a different channel", async () => {
    await reserve(standalone, undefined, latestMember);
    await expect(reset()).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: latestStandalone } })).status).toBe(
      "queued",
    );
  });
  it("refuses unknown non-reservation values without deleting them", async () => {
    await reserve(standalone, undefined, "unknown-queue-value");
    await expect(reset()).rejects.toMatchObject({ statusCode: 403 });
    expect(await redis().get(slot())).toBe("unknown-queue-value");
  });
  it("never deletes a newer queue value that replaced the observed reservation", async () => {
    const original = redis().deleteIfValueMatches.bind(redis()),
      newer = randomUUID();
    vi.spyOn(redis(), "deleteIfValueMatches").mockImplementation(async (key, expected) => {
      if (key === slot()) await redis().set(key, newer, 60);
      return original(key, expected);
    });
    await reset();
    expect(await redis().get(slot())).toBe(newer);
  });
  it("checks former member resources before cancelling their persisted active tasks", async () => {
    await prisma.relayChannel.update({ where: { id: member }, data: { pooledParentId: null } });
    await policy("Deny", platformRelayChannelArn(member));
    await expect(reset(pool)).rejects.toMatchObject({ statusCode: 403 });
    expect(await redis().get(slot(pool, member))).toBe(latestMember);
  });
  it("does not fall back to legacy members when a strict child exists", async () => {
    await prisma.relayChannelMember.create({ data: { relayChannelId: pool, memberChannelId: outsider, priority: 0 } });
    await expect(reset(pool, outsider)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks identity after waiting for queue coordination", async () => {
    vi.spyOn(RelayChannelProbeLockService.getInstance(), "withQueueWrite").mockImplementation(async (_id, callback) => {
      await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
      return callback();
    });
    await expect(reset()).rejects.toMatchObject({ statusCode: 403 });
    expect(await redis().get(slot())).toBe(latestStandalone);
  });
  it("rolls back executed cancellations and leaves Redis untouched when revoked at commit", async () => {
    const transaction = prisma.$transaction.bind(prisma),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let cancelled = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const update = tx.relayChannelProbeRun.updateMany.bind(tx.relayChannelProbeRun);
        vi.spyOn(tx.relayChannelProbeRun, "updateMany").mockImplementation((args) => {
          cancelled = true;
          return update(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      return cancelled ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : rows;
    });
    await expect(reset()).rejects.toMatchObject({ statusCode: 403 });
    expect(cancelled).toBe(true);
    expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: latestStandalone } })).status).toBe(
      "queued",
    );
    expect(await redis().get(slot())).toBe(latestStandalone);
  });
  it("rejects an unavailable queue read before cancelling persisted work", async () => {
    vi.spyOn(redis(), "getWithResult").mockResolvedValue(null);
    await expect(reset()).rejects.toThrow();
    expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: latestStandalone } })).status).toBe(
      "queued",
    );
  });
  it("preserves a stale reservation when cleanup is unavailable after commit", async () => {
    const original = redis().deleteIfValueMatches.bind(redis());
    vi.spyOn(redis(), "deleteIfValueMatches").mockImplementation((key, value) =>
      key === slot() ? Promise.resolve(null) : original(key, value),
    );
    await expect(reset()).rejects.toThrow();
    expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: latestStandalone } })).status).toBe(
      "cancelled",
    );
    expect(await redis().get(slot())).toBe(latestStandalone);
  });
  it.each(["private", "hidden"])("retains %s visibility checks", async (visibilityMode) => {
    await prisma.relayChannel.update({ where: { id: standalone }, data: { visibilityMode } });
    await expect(reset()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires persisted deployment qualification independently of policies", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await policy("Allow", "*");
    await expect(reset()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "runs legacy cancellation once without destructive preview in %s",
    async (selected) => {
      env.security.iamAuthorizationMode = selected;
      await policy("Deny", platformRelayProbeRunArn(standalone, latestStandalone));
      const iam = IamAuthorizationService.getInstance(),
        original = iam.authorizeMany.bind(iam);
      vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
        expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: latestStandalone } })).status).toBe(
          "queued",
        );
        expect(await redis().get(slot())).toBe(latestStandalone);
        return original(input);
      });
      await reset();
      expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: latestStandalone } })).status).toBe(
        "cancelled",
      );
      expect(await redis().get(slot())).toBeNull();
    },
  );
});
