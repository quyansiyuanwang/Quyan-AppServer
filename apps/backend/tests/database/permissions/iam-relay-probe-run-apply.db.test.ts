import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { RelayChannelProbeRepository } from "@/store/relay/relay-channel-probe.repository";
import { RelayProbeRunApplyRepository } from "@/store/relay/relay-probe-run-apply.repository";
import { RelayChannelProbeLockService } from "@/services/relay/relay-channel-probe-lock.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformRelayProbeProfileArn, platformRelayProbeRunArn } from "@/iam/resources/platform-relay-probe-resources";
import { buildProbePricingSnapshot, fingerprintProbePricing } from "@/services/relay/relay-probe-pricing";
import { projectRelayModelRates } from "@/services/relay/relay-configuration-projection";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, groupId: string, channelId: string, profileId: string, runId: string;
let model: string, modelId: string, configId: string, prefix: string, channelIds: string[];
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const apply = (ids = [runId], overrides?: Array<{ runId: string; multiplier: number }>, forceLargeChange?: boolean) =>
  RelayChannelProbeService.getInstance().applyRuns({ runIds: ids, overrides, forceLargeChange }, actor, request());
async function fingerprint(channel = channelId, profile = profileId, memberId?: string) {
  const [billing, settings, rate] = await Promise.all([
    prisma.relayChannel.findUniqueOrThrow({ where: { id: channel } }),
    prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: profile } }),
    prisma.modelPricing.findUniqueOrThrow({ where: { id: modelId } }),
  ]);
  const mapping = memberId
    ? (await prisma.relayChannel.findUniqueOrThrow({ where: { id: memberId } })).modelMapping
    : billing.modelMapping;
  return fingerprintProbePricing(
    buildProbePricingSnapshot(settings, billing, mapping, projectRelayModelRates([rate])[0]!, 1),
  );
}
async function createRun(channel = channelId, profile = profileId, memberId?: string, value = 1.1) {
  return prisma.relayChannelProbeRun.create({
    data: {
      relayChannelId: channel,
      profileId: profile,
      probeMemberChannelId: memberId,
      requestedByUserId: actor,
      distributionMultiplier: 1,
      status: "succeeded",
      calibrationStatus: "verified",
      finishedAt: new Date(),
      suggestedMultiplier: value,
      sourceChannelMultiplier: 1,
      pricingFingerprint: await fingerprint(channel, profile, memberId),
      samples: { private: "fixture-private-ledger" },
      pricingSnapshot: { private: "fixture-pricing-details" },
    },
  });
}
async function policy(resource: string, effect: "Deny" | "Allow" = "Deny") {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:ApplyProbeRun", Resource: resource },
  });
  const p = await RamPolicyRepository.getInstance().createPolicy({
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
      policyId: p.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
async function poolFixture() {
  await prisma.relayChannel.update({ where: { id: channelId }, data: { channelType: "pooled" } });
  const member = await prisma.relayChannel.create({ data: { name: prefix, pooledParentId: channelId } });
  channelIds.push(member.id);
  const row = await createRun(channelId, profileId, member.id);
  return { member: member.id, run: row.id };
}
async function unchanged(id = runId, channel = channelId) {
  expect(Number((await prisma.relayChannel.findUniqueOrThrow({ where: { id: channel } })).multiplier)).toBe(1);
  expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id } })).appliedAt).toBeNull();
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "probe-apply-" + randomUUID();
  model = prefix;
  channelIds = [];
  owner = actor = groupId = modelId = configId = channelId = profileId = runId = "";
  owner = (
    await prisma.user.create({
      data: { username: prefix, password: "fixture-only", userType: "root", permissionAdds: [], permissionRemoves: [] },
    })
  ).id;
  groupId = (
    await prisma.group.create({
      data: {
        username: prefix,
        name: "Fixture multiplier operator",
        accountOwnerId: null,
        permissions: [Permission.RELAY_CHANNEL_MULTIPLIER_ADJUST],
      },
    })
  ).id;
  actor = (
    await prisma.user.create({
      data: {
        username: prefix + "-actor",
        password: "fixture-only",
        userType: "ram_user",
        permissionAdds: [],
        permissionRemoves: [],
        accountOwnerId: owner,
        parentUserId: owner,
        groupId,
      },
    })
  ).id;
  channelId = (
    await prisma.relayChannel.create({
      data: { name: prefix, multiplier: 1, openaiUpstreamApiKey: "fixture-private-key" },
    })
  ).id;
  channelIds.push(channelId);
  profileId = (
    await prisma.relayChannelProbeProfile.create({
      data: {
        relayChannelId: channelId,
        probeModel: model,
        probeFormat: "openai-chat-completions",
        probePayload: { private: "fixture-private-payload" },
        workflow: [],
        encryptedCredentials: "fixture-corrupt-ciphertext",
        credentialIv: "fixture-iv",
        credentialAuthTag: "fixture-tag",
      },
    })
  ).id;
  modelId = (await prisma.modelPricing.create({ data: { model, inputPrice: 1, outputPrice: 2 } })).id;
  configId = (await prisma.relayConfig.create({ data: { globalMultiplier: 1 } })).id;
  runId = (await createRun()).id;
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
  await prisma.modelPricing.deleteMany({ where: { id: modelId } });
  await prisma.relayConfig.deleteMany({ where: { id: configId } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("resource-authorized probe result application", () => {
  it("applies a fresh verified result and marks it atomically without needing ciphertext", async () => {
    expect(await apply()).toEqual({ applied: 1, rejected: [] });
    expect(Number((await prisma.relayChannel.findUniqueOrThrow({ where: { id: channelId } })).multiplier)).toBe(1.1);
    const run = await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.appliedAt).not.toBeNull();
    expect(run.appliedByUserId).toBe(actor);
    expect(Number(run.appliedMultiplier)).toBe(1.1);
  });
  it.each(["channel", "profile", "run"])("denies %s before pricing or profile hydration", async (kind) => {
    await policy(
      kind === "channel"
        ? platformRelayChannelArn(channelId)
        : kind === "profile"
          ? platformRelayProbeProfileArn(channelId, profileId)
          : platformRelayProbeRunArn(channelId, runId),
    );
    const read = vi.spyOn(prisma.modelPricing, "findMany"),
      legacy = vi.spyOn(RelayChannelProbeRepository.getInstance(), "findRunsWithChannels");
    expect((await apply()).applied).toBe(0);
    expect(read).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
    await unchanged();
  });
  it("an account policy cannot manufacture platform multiplier-management qualification", async () => {
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.RELAY_CHANNEL_PROBE_EXECUTE] },
    });
    await policy("*", "Allow");
    await expect(apply()).rejects.toMatchObject({ statusCode: 403 });
    await unchanged();
  });
  it("rechecks qualification after waiting on the channel writer", async () => {
    const lock = RelayChannelProbeLockService.getInstance(),
      original = lock.withWrite.bind(lock);
    vi.spyOn(lock, "withWrite").mockImplementation(async (id, operation, timeout) => {
      await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      return original(id, operation, timeout);
    });
    expect((await apply()).applied).toBe(0);
    await unchanged();
  });
  it.each(["failed", "queued", "unverified", "expired", "future", "missing-fingerprint", "missing-source"])(
    "rejects %s results without changing pricing",
    async (kind) => {
      const data: Prisma.RelayChannelProbeRunUpdateInput =
        kind === "failed" || kind === "queued"
          ? { status: kind }
          : kind === "unverified"
            ? { calibrationStatus: "pending" }
            : kind === "expired"
              ? { finishedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }
              : kind === "future"
                ? { finishedAt: new Date(Date.now() + 60 * 1000) }
                : kind === "missing-fingerprint"
                  ? { pricingFingerprint: null }
                  : { sourceChannelMultiplier: null };
      await prisma.relayChannelProbeRun.update({ where: { id: runId }, data });
      expect((await apply()).applied).toBe(0);
      await unchanged();
    },
  );
  it("never applies an already applied run a second time", async () => {
    expect((await apply()).applied).toBe(1);
    expect((await apply()).applied).toBe(0);
  });
  it("preserves a concurrently changed multiplier", async () => {
    await prisma.relayChannel.update({ where: { id: channelId }, data: { multiplier: 1.2 } });
    expect((await apply()).applied).toBe(0);
    expect(Number((await prisma.relayChannel.findUniqueOrThrow({ where: { id: channelId } })).multiplier)).toBe(1.2);
    expect((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: runId } })).appliedAt).toBeNull();
  });
  it.each(["model-rate", "global-rate", "mapping", "target", "profile", "time-rules"])(
    "rejects changed %s pricing snapshots",
    async (kind) => {
      if (kind === "model-rate") await prisma.modelPricing.update({ where: { id: modelId }, data: { inputPrice: 3 } });
      if (kind === "global-rate")
        await prisma.relayConfig.update({ where: { id: configId }, data: { globalMultiplier: 2 } });
      if (kind === "mapping")
        await prisma.relayChannel.update({
          where: { id: channelId },
          data: { modelMapping: { [model]: "missing-model" } },
        });
      if (kind === "target")
        await prisma.relayChannelProbeTargetConfig.create({
          data: { profileId, targetChannelId: channelId, probeModel: "missing-model" },
        });
      if (kind === "profile")
        await prisma.relayChannelProbeProfile.update({ where: { id: profileId }, data: { cacheMode: "normal" } });
      if (kind === "time-rules")
        await prisma.relayChannel.update({
          where: { id: channelId },
          data: { contextLengthMultipliers: [{ threshold: 100, multiplier: 2 }] },
        });
      expect((await apply()).applied).toBe(0);
      await unchanged();
    },
  );
  it("rejects a result whose profile was deleted or replaced", async () => {
    await prisma.relayChannelProbeProfile.delete({ where: { id: profileId } });
    expect((await apply()).applied).toBe(0);
    await unchanged();
  });
  it("requires an independent compatible run for a large suggested change", async () => {
    await prisma.relayChannelProbeRun.update({ where: { id: runId }, data: { suggestedMultiplier: 1.5 } });
    expect((await apply()).applied).toBe(0);
    await unchanged();
    await createRun(channelId, profileId, undefined, 1.52);
    expect((await apply()).applied).toBe(1);
  });
  it("does not read a denied confirmation result to justify a large change", async () => {
    await prisma.relayChannelProbeRun.update({ where: { id: runId }, data: { suggestedMultiplier: 1.5 } });
    const other = await createRun(channelId, profileId, undefined, 1.52);
    await policy(platformRelayProbeRunArn(channelId, other.id));
    expect((await apply()).applied).toBe(0);
    await unchanged();
  });
  it.each(["different-pricing", "different-source", "unstable-value"])(
    "a %s result is not an independent confirmation",
    async (kind) => {
      await prisma.relayChannelProbeRun.update({ where: { id: runId }, data: { suggestedMultiplier: 1.5 } });
      const other = await createRun(channelId, profileId, undefined, kind === "unstable-value" ? 1.8 : 1.52);
      if (kind === "different-pricing")
        await prisma.relayChannelProbeRun.update({
          where: { id: other.id },
          data: { pricingFingerprint: "old-fingerprint" },
        });
      if (kind === "different-source")
        await prisma.relayChannelProbeRun.update({ where: { id: other.id }, data: { sourceChannelMultiplier: 0.9 } });
      expect((await apply()).applied).toBe(0);
      await unchanged();
    },
  );
  it("allows bounded overrides and explicit large-change confirmation without bypassing snapshot validation", async () => {
    expect((await apply([runId], [{ runId, multiplier: 1.5 }], true)).applied).toBe(1);
    expect(
      Number((await prisma.relayChannelProbeRun.findUniqueOrThrow({ where: { id: runId } })).appliedMultiplier),
    ).toBe(1.5);
  });
  it("requires every affected pool member, not just the measured member", async () => {
    const pooled = await poolFixture();
    const sibling = await prisma.relayChannel.create({ data: { name: prefix, pooledParentId: channelId } });
    channelIds.push(sibling.id);
    await policy(platformRelayChannelArn(sibling.id));
    expect((await apply([pooled.run])).applied).toBe(0);
    await unchanged(pooled.run);
  });
  it("applies authorized pooled results using the measured member's mapping", async () => {
    const pooled = await poolFixture();
    expect((await apply([pooled.run])).applied).toBe(1);
  });
  it("strict topology never falls back to a legacy edge for an unrelated or disabled member", async () => {
    const pooled = await poolFixture();
    const foreign = await prisma.relayChannel.create({ data: { name: prefix } });
    channelIds.push(foreign.id);
    await prisma.relayChannelMember.create({
      data: { relayChannelId: channelId, memberChannelId: foreign.id, priority: 1 },
    });
    await prisma.relayChannelProbeRun.update({ where: { id: pooled.run }, data: { probeMemberChannelId: foreign.id } });
    expect((await apply([pooled.run])).applied).toBe(0);
    await unchanged(pooled.run);
  });
  it("revocation after both writes rolls back the multiplier and applied marker", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    let changed = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const update = tx.relayChannelProbeRun.updateMany.bind(tx.relayChannelProbeRun);
        vi.spyOn(tx.relayChannelProbeRun, "updateMany").mockImplementation((args) => {
          changed = true;
          return update(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      return changed ? result.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : result;
    });
    expect((await apply()).applied).toBe(0);
    expect(changed).toBe(true);
    await unchanged();
  });
  it("failed independent targets do not cancel successful applications", async () => {
    expect(await apply(["fixture-missing-run", runId])).toMatchObject({
      applied: 1,
      rejected: [{ runId: "fixture-missing-run" }],
    });
  });
  it("shadow previews scopes and invokes legacy application once, even after a shadow deny", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await policy(platformRelayProbeRunArn(channelId, runId));
    const native = vi.spyOn(RelayProbeRunApplyRepository.getInstance(), "apply"),
      legacy = vi.spyOn(RelayChannelProbeRepository.getInstance(), "findRunsWithChannels");
    expect((await apply()).applied).toBe(1);
    expect(native).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("keeps authorization failures generic and does not echo internal or upstream error messages", async () => {
    vi.spyOn(RelayProbeRunApplyRepository.getInstance(), "apply").mockRejectedValue(
      new Error("fixture-secret-do-not-return"),
    );
    const result = await apply();
    expect(result.applied).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("fixture-secret-do-not-return");
    await unchanged();
  });
  it("shadow performs no native writes or pricing reads even when its identity preview succeeds", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const transaction = prisma.$transaction.bind(prisma);
    let nativePricingReads = 0,
      nativeWrites = 0;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        if (options?.isolationLevel === "Serializable") {
          const findMany = tx.modelPricing.findMany.bind(tx.modelPricing),
            update = tx.relayChannel.updateMany.bind(tx.relayChannel);
          vi.spyOn(tx.modelPricing, "findMany").mockImplementation((args) => {
            nativePricingReads++;
            return findMany(args);
          });
          vi.spyOn(tx.relayChannel, "updateMany").mockImplementation((args) => {
            nativeWrites++;
            return update(args);
          });
        }
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    expect((await apply()).applied).toBe(1);
    expect(nativePricingReads).toBe(0);
    expect(nativeWrites).toBe(0);
  });
  it("cannot apply without context or with duplicate/foreign overrides", async () => {
    const service = RelayChannelProbeService.getInstance();
    await expect(service.applyRuns({ runIds: [runId] }, actor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(apply([runId, runId])).rejects.toMatchObject({ statusCode: 400 });
    await expect(apply([runId], [{ runId: "foreign", multiplier: 1 }])).rejects.toMatchObject({ statusCode: 400 });
    await unchanged();
  });
});
