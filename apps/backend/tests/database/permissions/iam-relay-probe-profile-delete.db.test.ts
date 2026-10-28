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
import { RelayChannelProbeLockService } from "@/services/relay/relay-channel-probe-lock.service";
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
const remove = (id = standalone) => RelayChannelProbeService.getInstance().clearProfile(id, actor, request());
let linkedRun: string, accountId: string | undefined;
async function bindAccount() {
  accountId = (
    await prisma.relayChannelProbeAccount.create({
      data: {
        name: prefix,
        tokenPath: "data.token",
        fallbackTtlSeconds: 30,
        minLoginIntervalSeconds: 60,
        encryptedCredentials: "fixture-account-ciphertext",
        credentialIv: "fixture-iv",
        credentialAuthTag: "fixture-tag",
      },
    })
  ).id;
  await prisma.relayChannelProbeTargetConfig.create({
    data: { profileId: standaloneProfile, targetChannelId: standalone, accountId },
  });
  return accountId;
}
async function qualifyAccountManagement() {
  await prisma.group.update({
    where: { id: groupId },
    data: { permissions: [Permission.RELAY_CHANNEL_PROBE_EXECUTE, Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE] },
  });
}

async function policy(effect: "Allow" | "Deny", resource: string, action = "quyan:relay:DeleteProbeProfile") {
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
  prefix = "probe-profile-delete-" + randomUUID();
  channelIds = [];
  accountId = undefined;
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
  linkedRun = (
    await prisma.relayChannelProbeRun.create({
      data: {
        relayChannelId: standalone,
        requestedByUserId: actor,
        distributionMultiplier: 1,
        status: "succeeded",
        profileId: standaloneProfile,
      },
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  env.relay.channelProbe.masterKey = masterKey;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayChannelProbeRun.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannelMember.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannel.updateMany({ where: { id: { in: channelIds } }, data: { pooledParentId: null } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: channelIds } } });
  if (accountId) await prisma.relayChannelProbeAccount.deleteMany({ where: { id: accountId } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("probe profile deletion and collateral authorization", () => {
  it("deletes the profile and target settings while retaining detached history", async () => {
    await prisma.relayChannelProbeTargetConfig.create({
      data: { profileId: standaloneProfile, targetChannelId: standalone },
    });
    await remove();
    expect(await prisma.relayChannelProbeProfile.count({ where: { id: standaloneProfile } })).toBe(0);
    expect(await prisma.relayChannelProbeTargetConfig.count({ where: { profileId: standaloneProfile } })).toBe(0);
    expect(
      await prisma.relayChannelProbeRun.findUnique({ where: { id: linkedRun }, select: { profileId: true } }),
    ).toEqual({ profileId: null });
    expect(await prisma.relayChannelProbeProfile.count({ where: { id: poolProfile } })).toBe(1);
  });
  it.each(["channel", "profile", "run"])("requires the %s resource before deletion", async (kind) => {
    const resource =
      kind === "channel"
        ? platformRelayChannelArn(standalone)
        : kind === "profile"
          ? platformRelayProbeProfileArn(standalone, standaloneProfile)
          : platformRelayProbeRunArn(standalone, linkedRun);
    await policy("Deny", resource);
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayChannelProbeProfile.count({ where: { id: standaloneProfile } })).toBe(1);
    expect((await prisma.relayChannelProbeRun.findUnique({ where: { id: linkedRun } }))?.profileId).toBe(
      standaloneProfile,
    );
  });
  it.each(["queued", "running"])("preserves the active %s task and profile", async (status) => {
    await prisma.relayChannelProbeRun.update({ where: { id: linkedRun }, data: { status } });
    await expect(remove()).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.relayChannelProbeProfile.count({ where: { id: standaloneProfile } })).toBe(1);
  });
  it("requires permission on every configured physical member", async () => {
    await prisma.relayChannelProbeTargetConfig.create({ data: { profileId: poolProfile, targetChannelId: member } });
    await policy("Deny", platformRelayChannelArn(member));
    await expect(remove(pool)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires dedicated platform management for a bound shared account", async () => {
    const id = await bindAccount();
    await policy("Allow", platformRelayProbeAccountArn(id), "quyan:relay:UnbindProbeAccount");
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    await qualifyAccountManagement();
    await remove();
    expect(await prisma.relayChannelProbeAccount.count({ where: { id } })).toBe(1);
  });
  it("honors an account-specific Unbind deny", async () => {
    const id = await bindAccount();
    await qualifyAccountManagement();
    await policy("Deny", platformRelayProbeAccountArn(id), "quyan:relay:UnbindProbeAccount");
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayChannelProbeTargetConfig.count({ where: { accountId: id } })).toBe(1);
  });
  it("honors legacy removals of the dedicated account-management permission", async () => {
    await bindAccount();
    await qualifyAccountManagement();
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE] },
    });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks the identity after waiting for the channel lock", async () => {
    vi.spyOn(RelayChannelProbeLockService.getInstance(), "withWrite").mockImplementation(async (_id, callback) => {
      await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
      return callback();
    });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayChannelProbeProfile.count({ where: { id: standaloneProfile } })).toBe(1);
  });
  it("rolls back profile deletion target cascade and run detachment if unbind is revoked at commit", async () => {
    const id = await bindAccount();
    await qualifyAccountManagement();
    const transaction = prisma.$transaction.bind(prisma),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let removed = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const deleteProfile = tx.relayChannelProbeProfile.deleteMany.bind(tx.relayChannelProbeProfile);
        vi.spyOn(tx.relayChannelProbeProfile, "deleteMany").mockImplementation((args) => {
          removed = true;
          return deleteProfile(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      return removed && input.action === "quyan:relay:UnbindProbeAccount"
        ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const }))
        : rows;
    });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
    expect(removed).toBe(true);
    expect(await prisma.relayChannelProbeProfile.count({ where: { id: standaloneProfile } })).toBe(1);
    expect(await prisma.relayChannelProbeTargetConfig.count({ where: { accountId: id } })).toBe(1);
    expect((await prisma.relayChannelProbeRun.findUnique({ where: { id: linkedRun } }))?.profileId).toBe(
      standaloneProfile,
    );
  });
  it("never reads the profile workflow or encrypted credentials while deleting", async () => {
    const transaction = prisma.$transaction.bind(prisma),
      reads: Prisma.RelayChannelProbeProfileFindUniqueArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const find = tx.relayChannelProbeProfile.findUnique.bind(tx.relayChannelProbeProfile);
        vi.spyOn(tx.relayChannelProbeProfile, "findUnique").mockImplementation((args) => {
          reads.push(args);
          return find(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await remove();
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every((args) => args.select && !args.select.encryptedCredentials && !args.select.workflow && !args.include),
    ).toBe(true);
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves the original operation in %s without preview side effects",
    async (selected) => {
      env.security.iamAuthorizationMode = selected;
      await policy("Deny", platformRelayProbeProfileArn(standalone, standaloneProfile));
      if (selected === "shadow") {
        const iam = IamAuthorizationService.getInstance(),
          original = iam.authorizeMany.bind(iam);
        vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
          expect(await prisma.relayChannelProbeProfile.count({ where: { id: standaloneProfile } })).toBe(1);
          return original(input);
        });
      }
      await remove();
      expect(await prisma.relayChannelProbeProfile.count({ where: { id: standaloneProfile } })).toBe(0);
    },
  );
});
