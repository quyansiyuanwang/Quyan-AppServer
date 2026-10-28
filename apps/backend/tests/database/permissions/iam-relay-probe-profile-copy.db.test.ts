import { randomUUID, createCipheriv, createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayProbeProfileCopyRepository } from "@/store/relay/relay-probe-profile-copy.repository";
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
const copy = (targets = [outsider], overwriteExisting = false) =>
  RelayChannelProbeService.getInstance().copyProfile(
    { sourceChannelId: standalone, targetChannelIds: targets, overwriteExisting },
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

async function policy(effect: "Allow" | "Deny", resource: string, action = "quyan:relay:CopyProbeProfile") {
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
  prefix = "probe-profile-copy-" + randomUUID();
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
describe("resource-scoped probe template copying", () => {
  it("copies settings without source credentials, even when source ciphertext is corrupt", async () => {
    await prisma.relayChannelProbeProfile.update({
      where: { id: standaloneProfile },
      data: { encryptedCredentials: "fixture-corrupt-source" },
    });
    const result = await copy();
    expect(result.rejected).toEqual([]);
    expect(result.copied).toHaveLength(1);
    const row = await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { relayChannelId: outsider } });
    expect(row.probeModel).toBe("fixture-model");
    expect(row.encryptedCredentials).toBeNull();
    expect(result.copied[0]!.credentialNames).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("fixture-corrupt-source");
  });
  it("preserves existing target credentials and stable target profile identity", async () => {
    const previous = await targetProfile();
    const result = await copy([outsider], true);
    expect(result.rejected).toEqual([]);
    expect(result.copied[0]).toMatchObject({
      id: previous.id,
      probeModel: "fixture-model",
      credentialNames: ["apiKey"],
    });
    expect(
      (await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: previous.id } })).encryptedCredentials,
    ).toBe(previous.encryptedCredentials);
  });
  it("never transfers source account bindings", async () => {
    await bindAccount();
    const result = await copy();
    expect(result.rejected).toEqual([]);
    expect(await prisma.relayChannelProbeTargetConfig.count({ where: { profileId: result.copied[0]!.id } })).toBe(0);
    expect(await prisma.relayChannelProbeTargetConfig.count({ where: { profileId: standaloneProfile } })).toBe(1);
  });
  it.each(["source-channel", "source-profile", "target-channel", "target-profile"])(
    "denied %s prevents source hydration and target writes",
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
      const reads = vi.spyOn(prisma.relayChannelProbeProfile, "findUniqueOrThrow");
      const result = await copy();
      expect(result.copied).toEqual([]);
      expect(result.rejected).toHaveLength(1);
      expect(reads).not.toHaveBeenCalled();
      expect(await prisma.relayChannelProbeProfile.count({ where: { relayChannelId: outsider } })).toBe(0);
    },
  );
  it("uses exact server-reserved target profile ids", async () => {
    const iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam),
      observed: string[] = [];
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      observed.push(...input.resources);
      return authorize(input);
    });
    const result = await copy();
    expect(observed).toContain(platformRelayProbeProfileArn(outsider, result.copied[0]!.id));
  });
  it("keeps independent authorized copies when another target is denied", async () => {
    await policy("Deny", platformRelayChannelArn(member));
    const result = await copy([member, outsider]);
    expect(result.copied).toHaveLength(1);
    expect(result.copied[0]!.relayChannelId).toBe(outsider);
    expect(result.rejected).toEqual([{ channelId: member, reason: expect.any(String) }]);
    expect(JSON.stringify(result.rejected)).not.toContain("fixture-private");
  });
  it("does not overwrite a target unless explicitly requested", async () => {
    const previous = await targetProfile();
    const result = await copy();
    expect(result.copied).toEqual([]);
    expect((await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: previous.id } })).probeModel).toBe(
      "target-before",
    );
  });
  it("cannot overwrite a profile with queued/running work", async () => {
    const previous = await targetProfile();
    await prisma.relayChannelProbeRun.create({
      data: { relayChannelId: outsider, profileId: previous.id, requestedByUserId: actor, distributionMultiplier: 1 },
    });
    expect((await copy([outsider], true)).copied).toEqual([]);
  });
  it("requires separate platform account-manager qualification before changing a bound target", async () => {
    const previous = await targetProfile(),
      id = await bindAccount();
    await prisma.relayChannelProbeTargetConfig.create({
      data: { profileId: previous.id, targetChannelId: outsider, accountId: id },
    });
    await policy("Allow", "*", "quyan:relay:ModifyBoundProbeProfile");
    expect((await copy([outsider], true)).copied).toEqual([]);
    await qualifyAccountManagement();
    expect((await copy([outsider], true)).copied).toHaveLength(1);
    expect(
      (await prisma.relayChannelProbeTargetConfig.findFirstOrThrow({ where: { profileId: previous.id } })).accountId,
    ).toBe(id);
  });
  it("honors a dedicated bound-account edit deny", async () => {
    const previous = await targetProfile(),
      id = await bindAccount();
    await qualifyAccountManagement();
    await prisma.relayChannelProbeTargetConfig.create({
      data: { profileId: previous.id, targetChannelId: outsider, accountId: id },
    });
    await policy("Deny", platformRelayProbeAccountArn(id), "quyan:relay:ModifyBoundProbeProfile");
    expect((await copy([outsider], true)).copied).toEqual([]);
    expect((await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: previous.id } })).probeModel).toBe(
      "target-before",
    );
  });
  it("refuses stale foreign target bindings before reading the source template", async () => {
    const previous = await targetProfile();
    await prisma.relayChannelProbeTargetConfig.create({ data: { profileId: previous.id, targetChannelId: member } });
    const read = vi.spyOn(prisma.relayChannelProbeProfile, "findUniqueOrThrow");
    expect((await copy([outsider], true)).copied).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
  it("only supports standalone source and target channels", async () => {
    const result = await RelayChannelProbeService.getInstance().copyProfile(
      { sourceChannelId: pool, targetChannelIds: [outsider] },
      actor,
      request(),
    );
    expect(result.copied).toEqual([]);
    expect((await copy([pool])).copied).toEqual([]);
  });
  it("refuses incompatible target format/model/upstream without reading its secrets", async () => {
    await prisma.relayChannel.update({ where: { id: outsider }, data: { openaiUpstreamApiKey: "" } });
    expect((await copy()).copied).toEqual([]);
    expect(await prisma.relayChannelProbeProfile.count({ where: { relayChannelId: outsider } })).toBe(0);
  });
  it("rechecks after waiting on both ordered locks", async () => {
    const locks = RelayChannelProbeLockService.getInstance(),
      write = locks.withWrite.bind(locks);
    vi.spyOn(locks, "withWrite").mockImplementation(async (id, operation, timeout) => {
      await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      return write(id, operation, timeout);
    });
    expect((await copy()).copied).toEqual([]);
    expect(await prisma.relayChannelProbeProfile.count({ where: { relayChannelId: outsider } })).toBe(0);
  });
  it("rolls back writes if the final decision is revoked", async () => {
    const transaction = prisma.$transaction.bind(prisma);
    let changed = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const create = tx.relayChannelProbeProfile.create.bind(tx.relayChannelProbeProfile);
        vi.spyOn(tx.relayChannelProbeProfile, "create").mockImplementation((args) => {
          changed = true;
          return create(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation((input) =>
      changed
        ? Promise.resolve(
            input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
          )
        : authorize(input),
    );
    expect((await copy()).copied).toEqual([]);
    expect(changed).toBe(true);
    expect(await prisma.relayChannelProbeProfile.count({ where: { relayChannelId: outsider } })).toBe(0);
  });
  it("shadow preview excludes source secrets and shares its reserved id with the single legacy write", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const native = vi.spyOn(RelayProbeProfileCopyRepository.getInstance(), "copy"),
      legacy = vi.spyOn(RelayChannelProbeRepository.getInstance(), "copyProfile");
    const result = await copy();
    expect(result.copied).toHaveLength(1);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(native.mock.calls[0]![2]).toBe(result.copied[0]!.id);
    expect(legacy.mock.calls[0]![3]).toBe(result.copied[0]!.id);
  });
  it("cannot be invoked in enforce without authenticated context or with self-copy targets", async () => {
    const service = RelayChannelProbeService.getInstance();
    await expect(
      service.copyProfile({ sourceChannelId: standalone, targetChannelIds: [outsider] }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(copy([standalone])).rejects.toMatchObject({ statusCode: 400 });
  });
  it("rolls back an executed overwrite when the supplemental bound-account grant is revoked", async () => {
    const previous = await targetProfile(),
      id = await bindAccount();
    await qualifyAccountManagement();
    await prisma.relayChannelProbeTargetConfig.create({
      data: { profileId: previous.id, targetChannelId: outsider, accountId: id },
    });
    const transaction = prisma.$transaction.bind(prisma);
    let changed = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const update = tx.relayChannelProbeProfile.update.bind(tx.relayChannelProbeProfile);
        vi.spyOn(tx.relayChannelProbeProfile, "update").mockImplementation((args) => {
          changed = true;
          return update(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      return changed && input.action === "quyan:relay:ModifyBoundProbeProfile"
        ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const }))
        : rows;
    });
    expect((await copy([outsider], true)).copied).toEqual([]);
    expect(changed).toBe(true);
    expect((await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: previous.id } })).probeModel).toBe(
      "target-before",
    );
    expect(
      (await prisma.relayChannelProbeTargetConfig.findFirstOrThrow({ where: { profileId: previous.id } })).accountId,
    ).toBe(id);
  });
});
