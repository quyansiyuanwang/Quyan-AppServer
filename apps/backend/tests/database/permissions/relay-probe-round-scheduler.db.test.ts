import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { RelayProbeRoundRepository } from "@/store/relay/relay-probe-round.repository";
import { RelayProbeRoundReportRepository } from "@/store/relay/relay-probe-round-report.repository";
import { RelayProbeScheduledAuthorityService } from "@/services/relay/relay-probe-scheduled-authority.service";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { RelayProbeRunExecutionIamService } from "@/services/relay/relay-probe-run-execution-iam.service";
import { RedisService } from "@/services/infrastructure/redis.service";
import { relayProbeQueueSlotKey } from "@/services/relay/relay-channel-probe-queue-policy";
import { probeDailyOccurrence } from "@/services/relay/relay-probe-round-policy";
import type { TypedRequest } from "@/types/express";
import { RelayProbePlanInitializerService } from "@/services/relay/relay-probe-plan-initializer.service";
import { RelayProbeRoundService } from "@/services/relay/relay-probe-round.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { RELAY_PROBE_ROUND_POLICY } from "@/services/relay/relay-probe-round-policy";

const rounds = RelayProbeRoundRepository.getInstance(),
  reports = RelayProbeRoundReportRepository.getInstance();
const originalMode = env.security.iamAuthorizationMode;
const authorizeActor = async (actor: string) => {
  const guard = await RelayProbeScheduledAuthorityService.getInstance().context(actor);
  await guard.recheck();
};
let actor: string, group: string, channel: string, schedule: string, minuteOfDay: number;
beforeEach(async () => {
  env.security.iamAuthorizationMode = "legacy";
  const localNow = new Date(Date.now() + RELAY_PROBE_ROUND_POLICY.utcOffsetMs);
  minuteOfDay = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  const prefix = "fixture-probe-round-" + randomUUID();
  group = (
    await prisma.group.create({
      data: {
        username: prefix,
        name: "Fixture scheduled probe manager",
        permissions: [Permission.RELAY_CHANNEL_PROBE_EXECUTE, Permission.RELAY_CHANNEL_PROBE_READ],
      },
    })
  ).id;
  actor = (
    await prisma.user.create({
      data: {
        username: prefix,
        password: "fixture-only",
        email: "probe-round@example.invalid",
        groupId: group,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  channel = (
    await prisma.relayChannel.create({
      data: { name: prefix, openaiUpstreamUrl: "https://fixture.invalid", openaiUpstreamApiKey: "fixture-model-key" },
    })
  ).id;
  await prisma.relayChannelProbeProfile.create({
    data: { relayChannelId: channel, probeModel: "fixture-model", probePayload: {}, workflow: [] },
  });
  schedule = (
    await prisma.relayProbeDailySchedule.create({
      data: {
        actorUserId: actor,
        enabled: true,
        minuteOfDay,
        nextRunAt: new Date(Date.now() - 5 * RELAY_PROBE_ROUND_POLICY.dayMs),
      },
    })
  ).id;
});
afterEach(async () => {
  env.security.iamAuthorizationMode = originalMode;
  const ids = (await prisma.relayProbeRound.findMany({ where: { scheduleId: schedule }, select: { id: true } })).map(
    (row) => row.id,
  );
  await prisma.relayProbeRoundNotification.deleteMany({ where: { roundId: { in: ids } } });
  await prisma.relayProbeRoundTarget.deleteMany({ where: { roundId: { in: ids } } });
  await prisma.relayProbeRound.deleteMany({ where: { scheduleId: schedule } });
  await prisma.relayProbeDailySchedule.deleteMany({ where: { id: schedule } });
  await prisma.relayChannelProbeRun.deleteMany({ where: { relayChannelId: channel } });
  await prisma.relayChannel.deleteMany({ where: { id: channel } });
  await prisma.notificationPreference.deleteMany({ where: { userId: actor } });
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: actor } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: actor } });
  await prisma.user.deleteMany({ where: { id: actor } });
  await prisma.group.deleteMany({ where: { id: group } });
  await RedisService.getInstance().delete(relayProbeQueueSlotKey(channel));
});
async function snapshot() {
  await rounds.due(new Date(), authorizeActor);
  const row = (await rounds.claimRounds("fixture-worker", new Date())).find((round) => round.scheduleId === schedule)!;
  const guard = await RelayProbeScheduledAuthorityService.getInstance().context(actor);
  await rounds.snapshotTargets(row.id, "fixture-worker", guard, async () => true);
  return { round: row, target: (await rounds.targets(row.id))[0]! };
}

describe("persistent scheduled probe rounds on native MySQL", { timeout: 20_000 }, () => {
  it("rotates pending work so the first batch cannot starve later targets", async () => {
    const { round, target } = await snapshot();
    await prisma.relayProbeRoundTarget.createMany({
      data: Array.from({ length: RELAY_PROBE_ROUND_POLICY.batchSize }, (_, index) => ({
        roundId: round.id,
        channelId: channel,
        memberChannelId: `fixture-fairness-${index}`,
        channelName: "Fixture fairness",
        profileId: target.profileId,
        profileUpdatedAt: target.profileUpdatedAt,
        updateTime: new Date(0),
      })),
    });
    const first = await rounds.targets(round.id);
    const second = await rounds.targets(round.id);
    expect(first).toHaveLength(RELAY_PROBE_ROUND_POLICY.batchSize);
    expect(second.some((row) => row.id === target.id)).toBe(true);
  });
  it("paginates authorized summaries without hydrating workflow or history payloads", async () => {
    const name = "fixture-probe-pagination-" + randomUUID();
    const ids: string[] = [];
    const payload = { fixture: "x".repeat(16_384) };
    try {
      for (let index = 0; index < 24; index++) {
        const row = await prisma.relayChannel.create({ data: { name: name + index } });
        ids.push(row.id);
        await prisma.relayChannelProbeProfile.create({
          data: {
            relayChannelId: row.id,
            probeModel: "fixture-model",
            probePayload: payload,
            workflow: [{ name: "balance", method: "GET", url: "https://fixture.invalid", body: payload }],
          },
        });
      }
      const service = RelayChannelProbeService.getInstance();
      const baselineStarted = performance.now();
      const baseline = (await service.listOverview(actor)).filter((row) => row.channelName.startsWith(name));
      const baselineElapsedMs = Math.round(performance.now() - baselineStarted);
      const started = performance.now();
      const page = await service.listOverviewPage({ search: name, page: 2, pageSize: 5, profile: "configured" }, actor);
      const pageElapsedMs = Math.round(performance.now() - started);
      expect(page.total).toBe(24);
      expect(page.items).toHaveLength(5);
      expect(new Set(page.items.map((row) => row.channelId)).size).toBe(5);
      for (const row of page.items) {
        expect(row.profile).not.toHaveProperty("workflow");
        expect(row.profile).not.toHaveProperty("probePayload");
        expect(row.profile).not.toHaveProperty("credentialNames");
        expect(row).not.toHaveProperty("members");
      }
      expect(JSON.stringify(page)).not.toContain(payload.fixture);
      const first = await service.listOverviewPage({ search: name, page: 1, pageSize: 5 }, actor);
      expect(first.items.map((row) => row.channelId).some((id) => page.items.some((row) => row.channelId === id))).toBe(
        false,
      );
      const empty = await service.listOverviewPage(
        { search: name, page: 1, pageSize: 5, profile: "unconfigured" },
        actor,
      );
      expect(empty.total).toBe(0);
      process.stdout.write(
        "Named probe pagination fixture " +
          JSON.stringify({
            channels: 24,
            pageSize: 5,
            responseBytes: Buffer.byteLength(JSON.stringify(page)),
            elapsedMs: pageElapsedMs,
            baselineResponseBytes: Buffer.byteLength(JSON.stringify(baseline)),
            baselineElapsedMs,
            overviewRequestsBefore: 1,
            overviewRequestsAfter: 1,
          }) +
          "\n",
      );
    } finally {
      await prisma.relayChannel.deleteMany({ where: { id: { in: ids } } });
    }
  });
  it("preflights and initializes a plan idempotently without invoking upstreams or changing permissions", async () => {
    await prisma.relayProbeDailySchedule.update({
      where: { id: schedule },
      data: { minuteOfDay: RELAY_PROBE_ROUND_POLICY.defaultMinuteOfDay + 1 },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor } });
    const service = RelayProbePlanInitializerService.getInstance();
    const before = await prisma.relayProbeDailySchedule.findUniqueOrThrow({ where: { id: schedule } });
    const preview = await service.run(user.username!, false);
    expect(preview).toMatchObject({ dryRun: true, changed: false, emailAvailable: true, eligibleTargets: 0 });
    expect((await prisma.relayProbeDailySchedule.findUniqueOrThrow({ where: { id: schedule } })).version).toBe(
      before.version,
    );
    expect(await service.run(user.username!, true)).toMatchObject({
      dryRun: false,
      changed: true,
      enabled: true,
      minuteOfDay: 180,
    });
    const saved = await prisma.relayProbeDailySchedule.findUniqueOrThrow({ where: { id: schedule } });
    expect((await service.run(user.username!, true)).changed).toBe(false);
    expect((await prisma.relayProbeDailySchedule.findUniqueOrThrow({ where: { id: schedule } })).version).toBe(
      saved.version,
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor } })).permissionAdds).toEqual(user.permissionAdds);
    await prisma.notificationPreference.deleteMany({ where: { userId: actor } });
  });
  it("deduplicates simultaneous workers and never backfills five missed days", async () => {
    await Promise.all([rounds.due(new Date(), authorizeActor), rounds.due(new Date(), authorizeActor)]);
    const rows = await prisma.relayProbeRound.findMany({ where: { scheduleId: schedule } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scheduledFor).toEqual(probeDailyOccurrence(new Date(), minuteOfDay));
    const [a, b] = await Promise.all([
      rounds.claimRounds("worker-a", new Date()),
      rounds.claimRounds("worker-b", new Date()),
    ]);
    expect([...a, ...b].filter((row) => row.scheduleId === schedule)).toHaveLength(1);
  });
  it("atomically attaches the deterministic run and creates the outbox only after terminal completion", async () => {
    const { round, target } = await snapshot();
    expect(target).toBeDefined();
    await RelayChannelProbeService.getInstance().createScheduledRun(target, "fixture-worker");
    expect((await rounds.execution(target.id))?.state).toBe("queued");
    await rounds.finish(round.id, "fixture-worker");
    expect(await prisma.relayProbeRoundNotification.count({ where: { roundId: round.id } })).toBe(0);
    await prisma.relayChannelProbeRun.update({
      where: { id: target.id },
      data: {
        status: "succeeded",
        calibrationStatus: "verified",
        upstreamBalanceBefore: 10,
        upstreamBalanceAfter: 9,
        upstreamBalanceDelta: 1,
        baseLocalCost: 0.5,
        sourceChannelMultiplier: 2,
        suggestedMultiplier: 3,
      },
    });
    await reports.reconcile((await rounds.targets(round.id))[0]!, false);
    await rounds.finish(round.id, "fixture-worker");
    expect(await prisma.relayProbeRoundNotification.count({ where: { roundId: round.id } })).toBe(1);
    const result = await prisma.relayProbeRoundTarget.findUniqueOrThrow({ where: { id: target.id } });
    expect(result.report).toMatchObject({
      balanceBefore: 10,
      balanceAfter: 9,
      suggestedMultiplier: 3,
      multiplierChange: 1,
      multiplierChangePercent: 50,
    });
    expect(JSON.stringify(result.report)).not.toContain("fixture-model-key");
  });
  it("rechecks persisted plan state before each external effect without a user JWT", async () => {
    const { target } = await snapshot();
    await RelayChannelProbeService.getInstance().createScheduledRun(target, "fixture-worker");
    await prisma.relayChannelProbeRun.update({
      where: { id: target.id },
      data: { status: "running", leaseOwner: "run-worker", leaseExpiresAt: new Date(Date.now() + 60_000) },
    });
    const recheck = await RelayProbeRunExecutionIamService.getInstance().prepare(target.id, "run-worker");
    await recheck();
    await prisma.relayProbeDailySchedule.update({ where: { id: schedule }, data: { enabled: false } });
    await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks native IAM revocation before another scheduled external effect", async () => {
    env.security.iamAuthorizationMode = "enforce";
    const { target } = await snapshot();
    await RelayChannelProbeService.getInstance().createScheduledRun(target, "fixture-worker");
    await prisma.relayChannelProbeRun.update({
      where: { id: target.id },
      data: { status: "running", leaseOwner: "run-worker", leaseExpiresAt: new Date(Date.now() + 60_000) },
    });
    const recheck = await RelayProbeRunExecutionIamService.getInstance().prepare(target.id, "run-worker");
    await recheck();
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:relay:CreateProbeRun",
        Resource: platformRelayChannelArn(channel),
      },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: actor,
      name: "fixture-scheduled-revocation",
      permissions: [],
      iamVersion: { ...parsed, createdBy: actor },
    });
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: actor,
        principalType: "user",
        principalId: actor,
        policyId: policy.id,
        scopeType: "account",
        scopeKey: "account",
        createdBy: actor,
      },
    });
    await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["2026-11-03T02:00:00Z", "2026-11-03T10:00:00Z"])(
    "permits a recent round and rejects an expired round at %s regardless of runner time",
    async (instant) => {
      const { round, target } = await snapshot();
      await RelayChannelProbeService.getInstance().createScheduledRun(target, "fixture-worker");
      const now = new Date(instant).getTime();
      await prisma.relayProbeRound.update({ where: { id: round.id }, data: { scheduledFor: new Date(now - 60_000) } });
      await prisma.relayChannelProbeRun.update({
        where: { id: target.id },
        data: { status: "running", leaseOwner: "run-worker", leaseExpiresAt: new Date(now + 60_000) },
      });
      vi.spyOn(Date, "now").mockReturnValue(now);
      const recheck = await RelayProbeRunExecutionIamService.getInstance().prepare(target.id, "run-worker");
      await expect(recheck()).resolves.toBeUndefined();
      await prisma.relayProbeRound.update({
        where: { id: round.id },
        data: { scheduledFor: new Date(now - RELAY_PROBE_ROUND_POLICY.roundTimeoutMs - 1) },
      });
      await expect(recheck()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("requires report access when enabling a plan", async () => {
    await prisma.group.update({
      where: { id: group },
      data: { permissions: [Permission.RELAY_CHANNEL_PROBE_EXECUTE] },
    });
    await expect(
      RelayProbeRoundService.getInstance().saveSchedule(actor, {
        enabled: true,
        minuteOfDay: 180,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.relayProbeDailySchedule.findUniqueOrThrow({ where: { id: schedule } })).minuteOfDay).toBe(
      minuteOfDay,
    );
  });
  it("recovers an expired notification lease and rejects a stale delivery worker", async () => {
    const { round, target } = await snapshot();
    await rounds.skipTarget(target.id, "queue", "fixture-active-task");
    await rounds.finish(round.id, "fixture-worker");
    const now = new Date();
    const [a, b] = await Promise.all([
      reports.claimNotifications("delivery-a", now),
      reports.claimNotifications("delivery-b", now),
    ]);
    const deliveries = [...a, ...b].filter((row) => row.roundId === round.id);
    expect(deliveries).toHaveLength(1);
    const row = deliveries[0]!;
    await prisma.relayProbeRoundNotification.update({ where: { id: row.id }, data: { leaseExpiresAt: new Date(0) } });
    const recovered = await reports.claimNotifications(
      "delivery-recovered",
      new Date(now.getTime() + RELAY_PROBE_ROUND_POLICY.leaseMs),
    );
    expect(recovered.some((item) => item.id === row.id)).toBe(true);
    await expect(reports.recheckDelivery(row.id, "delivery-a")).rejects.toMatchObject({ statusCode: 403 });
    await reports.delivered(row.id, "delivery-a", "delivered", row.id);
    expect((await prisma.relayProbeRoundNotification.findUniqueOrThrow({ where: { id: row.id } })).state).toBe(
      "sending",
    );
    await reports.delivered(row.id, "delivery-recovered", "delivered", row.id);
    expect((await prisma.relayProbeRoundNotification.findUniqueOrThrow({ where: { id: row.id } })).state).toBe(
      "delivered",
    );
  });
  it("expires a pending target after restart without issuing a model request", async () => {
    const { round, target } = await snapshot();
    await reports.reconcile(target, true);
    await rounds.finish(round.id, "fixture-worker");
    expect(await prisma.relayChannelProbeRun.count({ where: { id: target.id } })).toBe(0);
    expect((await prisma.relayProbeRoundTarget.findUniqueOrThrow({ where: { id: target.id } })).state).toBe(
      "timed_out",
    );
    expect(await prisma.relayProbeRoundNotification.count({ where: { roundId: round.id } })).toBe(1);
  });
  it("rolls back the shared profile when the target part of an atomic save fails", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { allowedModels: JSON.stringify(["fixture-model"]) },
    });
    const profile = await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { relayChannelId: channel } });
    const request = {
      user: { userId: actor },
      authContext: { principalUserId: actor, accountOwnerId: actor },
      headers: {},
      secure: true,
    } as unknown as TypedRequest;
    await expect(
      RelayChannelProbeService.getInstance().saveConfiguration(
        channel,
        {
          expectedProfileUpdatedAt: profile.updateTime.toISOString(),
          expectedTargetUpdatedAt: null,
          profile: {
            enabled: false,
            probeFormat: "openai-chat-completions",
            probeModel: "fixture-model",
            probePayload: {},
            workflow: [
              { name: "balance", method: "GET", url: "https://fixture.invalid/balance", balancePath: "data.balance" },
            ],
          },
          target: { probeModel: "not-allowed-fixture-model" },
        },
        actor,
        request,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    const saved = await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(saved.enabled).toBe(true);
    expect(saved.updateTime).toEqual(profile.updateTime);
    expect(await prisma.relayChannelProbeTargetConfig.count({ where: { profileId: profile.id } })).toBe(0);
  });
  it("rejects a stale atomic editor before replacing a newer saved profile", async () => {
    const profile = await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { relayChannelId: channel } });
    const request = {
      user: { userId: actor },
      authContext: { principalUserId: actor, accountOwnerId: actor },
      headers: {},
      secure: true,
    } as unknown as TypedRequest;
    const input = {
      expectedProfileUpdatedAt: profile.updateTime.toISOString(),
      expectedTargetUpdatedAt: null,
      profile: {
        enabled: true,
        probeFormat: "openai-chat-completions" as const,
        probeModel: "fixture-model",
        probePayload: {},
        workflow: [
          {
            name: "balance",
            method: "GET" as const,
            url: "https://fixture.invalid/balance",
            balancePath: "data.balance",
          },
        ],
      },
    };
    await RelayChannelProbeService.getInstance().saveConfiguration(channel, input, actor, request);
    await expect(
      RelayChannelProbeService.getInstance().saveConfiguration(channel, input, actor, request),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
