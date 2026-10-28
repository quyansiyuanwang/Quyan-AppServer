import { randomUUID, createCipheriv, createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeProfileArn,
  platformRelayProbeRunArn,
  platformRelayProbeAccountArn,
} from "@/iam/resources/platform-relay-probe-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, groupId: string, prefix: string;
let standalone: string, pool: string, member: string, outsider: string;
let channelIds: string[];
let standaloneProfile: string, poolProfile: string;
const masterKey = env.relay.channelProbe.masterKey;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const overview = () => RelayChannelProbeService.getInstance().listOverview(actor, request());
async function policy(effect: "Allow" | "Deny", resource: string, action = "quyan:relay:ListProbeOverview") {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: action, Resource: resource },
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
  prefix = "probe-overview-" + randomUUID();
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
      data: {
        name: prefix,
        openaiUpstreamUrl: "https://fixture.invalid",
        openaiUpstreamApiKey: "fixture-private-upstream",
        ...data,
      },
    });
    channelIds.push(row.id);
    return row.id;
  };
  standalone = await channel();
  pool = await channel({ channelType: "pooled" });
  member = await channel({ pooledParentId: pool });
  outsider = await channel();
  env.relay.channelProbe.masterKey = "fixture-profile-key-".repeat(5);
  const createProfile = async (channelId: string, credentials: Record<string, unknown>) => {
    const iv = randomBytes(12),
      cipher = createCipheriv(
        "aes-256-gcm",
        createHash("sha256").update(env.relay.channelProbe.masterKey).digest(),
        iv,
      );
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]).toString(
      "base64",
    );
    return (
      await prisma.relayChannelProbeProfile.create({
        data: {
          relayChannelId: channelId,
          probeModel: "fixture-model",
          probePayload: {},
          workflow: [],
          encryptedCredentials: ciphertext,
          credentialIv: iv.toString("base64"),
          credentialAuthTag: cipher.getAuthTag().toString("base64"),
        },
      })
    ).id;
  };
  standaloneProfile = await createProfile(standalone, { apiKey: "fixture-private-credential" });
  poolProfile = await createProfile(pool, {
    [member]: { apiKey: "fixture-member-credential" },
    [outsider]: { apiKey: "fixture-foreign-credential" },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  env.relay.channelProbe.masterKey = masterKey;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayChannelProbeTargetConfig.deleteMany({
    where: { profileId: { in: [standaloneProfile, poolProfile] } },
  });
  await prisma.relayChannelProbeAccount.deleteMany({ where: { name: prefix } });
  await prisma.relayChannelProbeRun.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannelMember.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannel.updateMany({ where: { id: { in: channelIds } }, data: { pooledParentId: null } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: channelIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("resource-scoped probe overview", () => {
  it("returns safe channel metadata, profile names and effective strict members", async () => {
    const result = await overview(),
      pooled = result.find((row) => row.channelId === pool)!;
    expect(pooled.profile?.credentialNames).toEqual([member]);
    expect(pooled.members).toEqual([
      expect.objectContaining({ channelId: member, hasCredentials: true, compatible: true }),
    ]);
    expect(result.find((row) => row.channelId === member)?.customerFacingTargets).toEqual([
      { channelId: pool, channelName: prefix },
    ]);
    const json = JSON.stringify(result);
    expect(json).not.toContain("fixture-private-credential");
    expect(json).not.toContain("fixture-private-upstream");
    expect(json).not.toContain("encryptedCredentials");
  });
  it("filters denied channels before reading their descriptive configuration", async () => {
    await policy("Deny", platformRelayChannelArn(standalone));
    const result = await overview();
    expect(result.some((row) => row.channelId === standalone)).toBe(false);
  });
  it("does not reveal a denied parent through topology labels", async () => {
    await policy("Deny", platformRelayChannelArn(pool));
    const result = await overview(),
      child = result.find((row) => row.channelId === member)!;
    expect(child.customerFacingTargets.some((row) => row.channelId === pool)).toBe(false);
    expect(result.some((row) => row.channelId === pool)).toBe(false);
  });
  it("never falls back to legacy edges when a strict child is denied", async () => {
    await prisma.relayChannelMember.create({
      data: { relayChannelId: pool, memberChannelId: outsider, priority: 0, weight: 1 },
    });
    await policy("Deny", platformRelayChannelArn(member));
    const result = await overview(),
      pooled = result.find((row) => row.channelId === pool)!;
    expect(pooled.members).toEqual([]);
    expect(pooled.profile?.credentialNames).toEqual([]);
    expect(
      result.find((row) => row.channelId === outsider)?.customerFacingTargets.some((row) => row.channelId === pool),
    ).toBe(false);
  });
  it("keeps strict precedence even when all strict children are deleted", async () => {
    await prisma.relayChannel.update({ where: { id: member }, data: { status: -1 } });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: pool, memberChannelId: outsider, priority: 0, weight: 1 },
    });
    expect((await overview()).find((row) => row.channelId === pool)?.members).toEqual([]);
  });
  it("uses legacy membership only when no strict child exists", async () => {
    await prisma.relayChannel.update({ where: { id: member }, data: { pooledParentId: null } });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: pool, memberChannelId: outsider, priority: 0, weight: 1, enabled: false },
    });
    expect((await overview()).find((row) => row.channelId === pool)?.members).toEqual([
      expect.objectContaining({ channelId: outsider, enabled: false }),
    ]);
  });
  it("does not load a denied profile even when its ciphertext is corrupt", async () => {
    await prisma.relayChannelProbeProfile.update({
      where: { id: standaloneProfile },
      data: { encryptedCredentials: "invalid" },
    });
    await policy("Deny", platformRelayProbeProfileArn(standalone, standaloneProfile), "quyan:relay:GetProbeProfile");
    expect((await overview()).find((row) => row.channelId === standalone)?.profile).toBeUndefined();
  });
  it("uses GetProbeProfile member grants for credential names independently of overview grants", async () => {
    await policy("Deny", platformRelayChannelArn(member), "quyan:relay:GetProbeProfile");
    const pooled = (await overview()).find((row) => row.channelId === pool)!;
    expect(pooled.members).toHaveLength(1);
    expect(pooled.profile?.credentialNames).toEqual([]);
    expect(pooled.members![0]!.hasCredentials).toBe(false);
  });
  it("does not replace a denied latest run with older history", async () => {
    const create = async (date: number) =>
      prisma.relayChannelProbeRun.create({
        data: {
          relayChannelId: standalone,
          requestedByUserId: actor,
          status: "succeeded",
          distributionMultiplier: 1,
          createTime: new Date(date),
        },
      });
    await create(1);
    const latest = await create(2);
    expect((await overview()).find((row) => row.channelId === standalone)?.latestRun?.id).toBe(latest.id);
    await policy("Deny", platformRelayProbeRunArn(standalone, latest.id), "quyan:relay:ListLatestProbeRuns");
    expect((await overview()).find((row) => row.channelId === standalone)?.latestRun).toBeUndefined();
  });
  it("omits target configuration and account-derived credential status when the bound account is denied", async () => {
    const account = await prisma.relayChannelProbeAccount.create({
      data: {
        name: prefix,
        encryptedCredentials: "fixture",
        credentialIv: "fixture",
        credentialAuthTag: "fixture",
        tokenPath: "token",
        fallbackTtlSeconds: 3600,
        minLoginIntervalSeconds: 60,
      },
    });
    await prisma.relayChannelProbeTargetConfig.create({
      data: { profileId: poolProfile, targetChannelId: member, accountId: account.id, probeModel: "override" },
    });
    await policy("Deny", platformRelayChannelArn(member), "quyan:relay:GetProbeProfile");
    expect((await overview()).find((row) => row.channelId === pool)?.members![0]).toMatchObject({
      hasCredentials: true,
      targetConfig: { accountId: account.id },
    });
    await policy("Deny", platformRelayProbeAccountArn(account.id), "quyan:relay:GetProbeTargetConfig");
    const target = (await overview()).find((row) => row.channelId === pool)?.members![0];
    expect(target?.targetConfig).toBeUndefined();
    expect(target?.hasCredentials).toBe(false);
  });
  it("does not select upstream key values or login credentials in any channel projection", async () => {
    const transaction = prisma.$transaction.bind(prisma),
      reads: Prisma.RelayChannelFindManyArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const find = tx.relayChannel.findMany.bind(tx.relayChannel);
        vi.spyOn(tx.relayChannel, "findMany").mockImplementation((args) => {
          reads.push(args ?? {});
          return find(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await overview();
    expect(reads.length).toBeGreaterThan(0);
    for (const args of reads) {
      expect(args.include).toBeUndefined();
      expect(args.select).toBeDefined();
      expect(Object.keys(args.select!).some((key) => /Upstream|ApiKey/.test(key))).toBe(false);
    }
  });
  it("rechecks related actions independently of the same channel ARN's overview grant", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let checkedProfile = false;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      if (
        input.action === "quyan:relay:GetProbeProfile" &&
        input.resources.includes(platformRelayProbeProfileArn(standalone, standaloneProfile))
      ) {
        if (checkedProfile) return result.map((row) => ({ ...row, decision: "ExplicitDeny" as const }));
        checkedProfile = true;
      }
      return result;
    });
    await expect(overview()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("scans beyond one authorization batch without loading denied configurations", async () => {
    const ids = Array.from({ length: 501 }, () => randomUUID());
    await prisma.relayChannel.createMany({ data: ids.map((id) => ({ id, name: prefix })) });
    channelIds.push(...ids);
    await policy("Deny", "*");
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam),
      sizes: number[] = [];
    vi.spyOn(iam, "authorizeMany").mockImplementation((input) => {
      sizes.push(input.resources.length);
      return original(input);
    });
    expect(await overview()).toEqual([]);
    expect(sizes).toContain(500);
    expect(sizes.some((size) => size > 0 && size < 500)).toBe(true);
    expect(sizes.every((size) => size <= 500)).toBe(true);
  });
  it("retains deployment qualification", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await policy("Allow", "*");
    await expect(overview()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["private", "hidden"])("omits %s channels", async (visibilityMode) => {
    await prisma.relayChannel.update({ where: { id: standalone }, data: { visibilityMode } });
    expect((await overview()).some((row) => row.channelId === standalone)).toBe(false);
  });
  it.each(["legacy", "shadow"] as const)("keeps legacy behavior in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await policy("Deny", platformRelayChannelArn(standalone));
    expect((await overview()).some((row) => row.channelId === standalone)).toBe(true);
  });
});
