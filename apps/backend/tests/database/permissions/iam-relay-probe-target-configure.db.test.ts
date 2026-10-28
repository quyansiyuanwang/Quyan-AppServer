import { randomUUID, createCipheriv, createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayProbeTargetConfigureRepository } from "@/store/relay/relay-probe-target-configure.repository";
import { RelayChannelProbeRepository } from "@/store/relay/relay-channel-probe.repository";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import {
  platformRelayProbeProfileArn,
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
let standaloneProfile: string;
const masterKey = env.relay.channelProbe.masterKey;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const configure = (
  channelId = outsider,
  sourceChannelId: string | undefined = standalone,
  overwriteExisting = false,
  memberChannelId?: string,
) =>
  RelayChannelProbeService.getInstance().configureTargets(
    {
      sourceChannelId,
      overwriteExisting,
      targets: [
        {
          channelId,
          ...(memberChannelId ? { memberChannelId } : {}),
          probeModel: "target-model",
          probeGroup: "target-group",
        },
      ],
    },
    actor,
    request(),
  );
let accountId: string | undefined;
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

async function policy(effect: "Allow" | "Deny", resource: string, action = "quyan:relay:ConfigureProbeTarget") {
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
  prefix = "probe-target-configure-" + randomUUID();
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
          probeFormat: "openai-chat-completions",
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
  await createProfile(pool, {
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
  await prisma.relayChannelProbeRun.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannelMember.deleteMany({ where: { relayChannelId: { in: channelIds } } });
  await prisma.relayChannel.updateMany({ where: { id: { in: channelIds } }, data: { pooledParentId: null } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: channelIds } } });
  if (accountId) await prisma.relayChannelProbeAccount.deleteMany({ where: { id: accountId } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});

async function targetProfile() {
  const source = await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: standaloneProfile } });
  const { id: _id, createTime: _created, updateTime: _updated, relayChannelId: _channel, ...data } = source;
  return prisma.relayChannelProbeProfile.create({
    data: {
      ...data,
      probePayload: data.probePayload as Prisma.InputJsonValue,
      workflow: data.workflow as Prisma.InputJsonValue,
      relayChannelId: outsider,
      probeModel: "target-before",
    },
  });
}
const targetConfig = (channelId = outsider) =>
  prisma.relayChannelProbeTargetConfig.findFirst({ where: { profile: { relayChannelId: channelId } } });
describe("resource-scoped probe target configuration", () => {
  it("creates a profile and per-target settings atomically without copying source credentials", async () => {
    await prisma.relayChannelProbeProfile.update({
      where: { id: standaloneProfile },
      data: { encryptedCredentials: "fixture-invalid-source-ciphertext" },
    });
    const result = await configure();
    expect(result.rejected).toEqual([]);
    expect(result.configured).toEqual([
      { channelId: outsider, probeModel: "target-model", probeGroup: "target-group" },
    ]);
    const row = await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { relayChannelId: outsider } });
    expect(row.probeModel).toBe("fixture-model");
    expect(row.encryptedCredentials).toBeNull();
    expect((await targetConfig())?.probeModel).toBe("target-model");
    expect(JSON.stringify(result)).not.toContain("fixture-invalid-source-ciphertext");
  });
  it("updates per-target settings without replacing existing profile defaults or credentials", async () => {
    const before = await targetProfile();
    const result = await configure();
    expect(result.rejected).toEqual([]);
    const after = await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.probeModel).toBe("target-before");
    expect(after.encryptedCredentials).toBe(before.encryptedCredentials);
  });
  it("source overwrite retains target credentials and bindings", async () => {
    const previous = await targetProfile(),
      account = await bindAccount();
    await qualifyAccountManagement();
    await prisma.relayChannelProbeTargetConfig.create({
      data: { profileId: previous.id, targetChannelId: outsider, accountId: account },
    });
    const result = await configure(outsider, standalone, true);
    expect(result.rejected).toEqual([]);
    const row = await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: previous.id } });
    expect(row.probeModel).toBe("fixture-model");
    expect(row.encryptedCredentials).toBe(previous.encryptedCredentials);
    expect((await targetConfig())?.accountId).toBe(account);
    expect(result.configured[0]).not.toHaveProperty("accountId");
  });
  it.each(["source-channel", "source-profile", "target-channel", "target-profile"])(
    "denied %s prevents template reads and writes",
    async (kind) => {
      await policy(
        "Deny",
        kind === "source-channel"
          ? platformRelayChannelArn(standalone)
          : kind === "source-profile"
            ? platformRelayProbeProfileArn(standalone, standaloneProfile)
            : kind === "target-channel"
              ? platformRelayChannelArn(outsider)
              : platformRelayProbeProfileArn(outsider, "fixture").replace(/fixture$/, "*"),
      );
      const read = vi.spyOn(prisma.relayChannelProbeProfile, "findUniqueOrThrow");
      expect((await configure()).configured).toEqual([]);
      expect(read).not.toHaveBeenCalled();
      expect(await targetConfig()).toBeNull();
    },
  );
  it("does not transfer source account bindings", async () => {
    await bindAccount();
    expect((await configure()).configured).toHaveLength(1);
    expect((await targetConfig())?.accountId).toBeNull();
  });
  it("requires existing settings or an authorized source template", async () => {
    const result = await RelayChannelProbeService.getInstance().configureTargets(
      { targets: [{ channelId: outsider }] },
      actor,
      request(),
    );
    expect(result.configured).toEqual([]);
    expect(await targetConfig()).toBeNull();
  });
  it("accepts source=target without locking the same resource twice", async () => {
    expect((await configure(standalone, standalone)).configured).toHaveLength(1);
  });
  it("configures only the requested physical member without changing other target overrides", async () => {
    await prisma.relayChannelProbeTargetConfig.create({
      data: {
        profileId: (await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { relayChannelId: pool } })).id,
        targetChannelId: member,
        probeGroup: "previous-group",
      },
    });
    const result = await configure(pool, standalone, false, member);
    expect(result.configured).toHaveLength(1);
    expect((await targetConfig(pool))?.probeGroup).toBe("target-group");
  });
  it("requires every current member when shared pooled profile defaults are overwritten", async () => {
    const sibling = await prisma.relayChannel.create({ data: { name: prefix, pooledParentId: pool } });
    channelIds.push(sibling.id);
    await policy("Deny", platformRelayChannelArn(sibling.id));
    expect((await configure(pool, standalone, true, member)).configured).toEqual([]);
    expect(await targetConfig(pool)).toBeNull();
  });
  it("does not require unrelated sibling authority for a target-only update", async () => {
    const sibling = await prisma.relayChannel.create({ data: { name: prefix, pooledParentId: pool } });
    channelIds.push(sibling.id);
    await policy("Deny", platformRelayChannelArn(sibling.id));
    expect((await configure(pool, standalone, false, member)).configured).toHaveLength(1);
  });
  it("requires dedicated account-management qualification for bound-target edits", async () => {
    await bindAccount();
    expect((await configure(standalone, standalone)).configured).toEqual([]);
    await qualifyAccountManagement();
    expect((await configure(standalone, standalone)).configured).toHaveLength(1);
  });
  it("honors supplemental bound-account Deny", async () => {
    const account = await bindAccount();
    await qualifyAccountManagement();
    await policy("Deny", platformRelayProbeAccountArn(account), "quyan:relay:ModifyBoundProbeProfile");
    expect((await configure(standalone, standalone)).configured).toEqual([]);
  });
  it("active tasks prevent profile and target changes", async () => {
    await prisma.relayChannelProbeRun.create({
      data: { relayChannelId: outsider, requestedByUserId: actor, distributionMultiplier: 1 },
    });
    expect((await configure()).configured).toEqual([]);
    expect(await prisma.relayChannelProbeProfile.count({ where: { relayChannelId: outsider } })).toBe(0);
  });
  it("format changes require an explicit compatible payload before any profile is created", async () => {
    const result = await RelayChannelProbeService.getInstance().configureTargets(
      { sourceChannelId: standalone, targets: [{ channelId: outsider, probeFormat: "anthropic" }] },
      actor,
      request(),
    );
    expect(result.configured).toEqual([]);
    expect(await prisma.relayChannelProbeProfile.count({ where: { relayChannelId: outsider } })).toBe(0);
  });
  it("rejects unsupported format/model/upstream before any profile is created", async () => {
    await prisma.relayChannel.update({ where: { id: outsider }, data: { allowedModels: '["other-model"]' } });
    expect((await configure()).configured).toEqual([]);
    expect(await prisma.relayChannelProbeProfile.count({ where: { relayChannelId: outsider } })).toBe(0);
  });
  it("keeps independent successful targets when another is denied", async () => {
    await policy("Deny", platformRelayChannelArn(member));
    const result = await RelayChannelProbeService.getInstance().configureTargets(
      { sourceChannelId: standalone, targets: [{ channelId: pool, memberChannelId: member }, { channelId: outsider }] },
      actor,
      request(),
    );
    expect(result.configured).toHaveLength(1);
    expect(result.configured[0]!.channelId).toBe(outsider);
    expect(result.rejected).toHaveLength(1);
  });
  it("shadow previews no settings and uses the reserved profile id for its single legacy creation", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const native = vi.spyOn(RelayProbeTargetConfigureRepository.getInstance(), "configure"),
      legacy = vi.spyOn(RelayChannelProbeRepository.getInstance(), "copyProfile");
    const result = await configure();
    expect(result.configured).toHaveLength(1);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(legacy.mock.calls[0]![3]).toBe(native.mock.calls[0]![2]);
    expect((await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { relayChannelId: outsider } })).id).toBe(
      native.mock.calls[0]![2],
    );
  });
  it("rolls back copied settings and target configuration together on final deny", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    let changed = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const upsert = tx.relayChannelProbeTargetConfig.upsert.bind(tx.relayChannelProbeTargetConfig);
        vi.spyOn(tx.relayChannelProbeTargetConfig, "upsert").mockImplementation((args) => {
          changed = true;
          return upsert(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      return changed ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : rows;
    });
    expect((await configure()).configured).toEqual([]);
    expect(changed).toBe(true);
    expect(await targetConfig()).toBeNull();
    expect(await prisma.relayChannelProbeProfile.count({ where: { relayChannelId: outsider } })).toBe(0);
  });
  it("rechecks executor membership after waiting on source/target locks", async () => {
    const locks = RelayChannelProbeLockService.getInstance(),
      original = locks.withWrite.bind(locks);
    vi.spyOn(locks, "withWrite").mockImplementation(async (id, operation, timeout) => {
      await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      return original(id, operation, timeout);
    });
    expect((await configure()).configured).toEqual([]);
    expect(await targetConfig()).toBeNull();
  });
  it("cannot configure without authenticated context or with duplicate targets", async () => {
    const service = RelayChannelProbeService.getInstance();
    await expect(service.configureTargets({ targets: [{ channelId: outsider }] }, actor)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      service.configureTargets({ targets: [{ channelId: outsider }, { channelId: outsider }] }, actor, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
