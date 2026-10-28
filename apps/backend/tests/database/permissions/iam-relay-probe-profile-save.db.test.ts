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
const input = () => ({
  enabled: true,
  probeFormat: "openai-chat-completions" as const,
  probeModel: "updated-model",
  probePayload: {},
  workflow: [
    { name: "balance", method: "GET" as const, url: "https://fixture.invalid/balance", balancePath: "balance" },
  ],
});
const save = (id = standalone, body = input()) =>
  RelayChannelProbeService.getInstance().upsertProfile(id, body, actor, request());
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

async function policy(effect: "Allow" | "Deny", resource: string, action = "quyan:relay:SaveProbeProfile") {
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
  prefix = "probe-profile-save-" + randomUUID();
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
describe("probe profile save resource authorization", () => {
  it("updates public configuration while preserving omitted credentials", async () => {
    const previous = await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: standaloneProfile } });
    const result = await save();
    expect(result).toMatchObject({ id: standaloneProfile, probeModel: "updated-model", credentialNames: ["apiKey"] });
    expect(JSON.stringify(result)).not.toContain("fixture-private-credential");
    expect(
      (await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: standaloneProfile } }))
        .encryptedCredentials,
    ).toBe(previous.encryptedCredentials);
  });
  it("replaces supplied standalone credentials without exposing their values", async () => {
    const result = await RelayChannelProbeService.getInstance().upsertProfile(
      standalone,
      { ...input(), credentials: { replacement: "fixture-new-private-value" } },
      actor,
      request(),
    );
    expect(result.credentialNames).toEqual(["replacement"]);
    const stored = await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: standaloneProfile } });
    expect(stored.encryptedCredentials).not.toContain("fixture-new-private-value");
    expect(JSON.stringify(result)).not.toContain("fixture-new-private-value");
  });
  it("allows adding pooled credentials when none were configured previously", async () => {
    await prisma.relayChannelProbeProfile.update({
      where: { id: poolProfile },
      data: { encryptedCredentials: null, credentialIv: null, credentialAuthTag: null },
    });
    const result = await RelayChannelProbeService.getInstance().upsertProfile(
      pool,
      { ...input(), memberCredentials: { [member]: { apiKey: "fixture-new-member-value" } } },
      actor,
      request(),
    );
    expect(result.credentialNames).toEqual([member]);
  });
  it("fails closed on corrupt stored pooled credentials without replacing the profile", async () => {
    await prisma.relayChannelProbeProfile.update({
      where: { id: poolProfile },
      data: { encryptedCredentials: "invalid" },
    });
    await expect(save(pool)).rejects.toThrow();
    expect((await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: poolProfile } })).probeModel).toBe(
      "fixture-model",
    );
  });
  it("requires channel and exact existing profile grants before reading secrets", async () => {
    await policy("Deny", platformRelayProbeProfileArn(standalone, standaloneProfile));
    await prisma.relayChannelProbeProfile.update({
      where: { id: standaloneProfile },
      data: { encryptedCredentials: "invalid" },
    });
    await expect(save()).rejects.toMatchObject({ statusCode: 403 });
    await policy("Deny", platformRelayChannelArn(pool));
    await expect(save(pool)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks the future profile ARN before creation and preserves its reserved ID", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam),
      resources: string[] = [];
    vi.spyOn(iam, "authorizeMany").mockImplementation((input) => {
      if (input.action === "quyan:relay:SaveProbeProfile") resources.push(...input.resources);
      return original(input);
    });
    const created = await save(outsider);
    expect(resources).toContain(platformRelayProbeProfileArn(outsider, created.id));
    expect(created.credentialNames).toEqual([]);
  });
  it("does not create a profile when its future resource is denied", async () => {
    await policy("Deny", `acs:platform:*:platform:relay-probe-profile/${outsider}/*`);
    await expect(save(outsider)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.relayChannelProbeProfile.count({ where: { relayChannelId: outsider } })).toBe(0);
  });
  it("authorizes every current pool member and preserves only current credential names", async () => {
    const result = await save(pool);
    expect(result.credentialNames).toEqual([member]);
    await policy("Deny", platformRelayChannelArn(member));
    await expect(save(pool)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not fall back to legacy members when the strict member is denied", async () => {
    await prisma.relayChannelMember.create({ data: { relayChannelId: pool, memberChannelId: outsider, priority: 0 } });
    await policy("Deny", platformRelayChannelArn(member));
    await expect(save(pool)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects credentials for a member outside the current pool", async () => {
    await expect(
      RelayChannelProbeService.getInstance().upsertProfile(
        pool,
        { ...input(), memberCredentials: { [outsider]: { apiKey: "fixture" } } },
        actor,
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("requires deployment account-manager qualification for bound profile edits", async () => {
    await bindAccount();
    await policy("Allow", "*", "quyan:relay:ModifyBoundProbeProfile");
    await expect(save()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires the separate exact bound-account grant", async () => {
    const id = await bindAccount();
    await qualifyAccountManagement();
    await policy("Deny", platformRelayProbeAccountArn(id), "quyan:relay:ModifyBoundProbeProfile");
    await expect(save()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("converts removed account-management permission into a native bound-edit Deny", async () => {
    await bindAccount();
    await qualifyAccountManagement();
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE] },
    });
    await expect(save()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("authorizes all configured targets even when they no longer belong to the pool", async () => {
    await prisma.relayChannelProbeTargetConfig.create({
      data: { profileId: poolProfile, targetChannelId: outsider, probeModel: "old-model" },
    });
    await policy("Deny", platformRelayChannelArn(outsider));
    await expect(save(pool)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks identity after waiting for the profile write lock", async () => {
    vi.spyOn(RelayChannelProbeLockService.getInstance(), "withWrite").mockImplementation(async (_id, callback) => {
      await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
      return callback();
    });
    await expect(save()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back an executed update when bound-account authorization is revoked", async () => {
    await bindAccount();
    await qualifyAccountManagement();
    const transaction = prisma.$transaction.bind(prisma),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let updated = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const update = tx.relayChannelProbeProfile.update.bind(tx.relayChannelProbeProfile);
        vi.spyOn(tx.relayChannelProbeProfile, "update").mockImplementation((args) => {
          updated = true;
          return update(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      return updated && input.action === "quyan:relay:ModifyBoundProbeProfile"
        ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const }))
        : rows;
    });
    await expect(save()).rejects.toMatchObject({ statusCode: 403 });
    expect(updated).toBe(true);
    expect(
      (await prisma.relayChannelProbeProfile.findUniqueOrThrow({ where: { id: standaloneProfile } })).probeModel,
    ).toBe("fixture-model");
    expect((await prisma.relayChannelProbeRun.findUnique({ where: { id: linkedRun } }))?.profileId).toBe(
      standaloneProfile,
    );
  });
  it("rolls back an executed creation on final resource denial", async () => {
    const transaction = prisma.$transaction.bind(prisma),
      iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let created = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const create = tx.relayChannelProbeProfile.create.bind(tx.relayChannelProbeProfile);
        vi.spyOn(tx.relayChannelProbeProfile, "create").mockImplementation((args) => {
          created = true;
          return create(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      return created ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : rows;
    });
    await expect(save(outsider)).rejects.toMatchObject({ statusCode: 403 });
    expect(created).toBe(true);
    expect(await prisma.relayChannelProbeProfile.count({ where: { relayChannelId: outsider } })).toBe(0);
  });
  it.each(["legacy", "shadow"] as const)("preserves the existing write flow once in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await policy("Deny", platformRelayProbeProfileArn(standalone, standaloneProfile));
    expect((await save()).probeModel).toBe("updated-model");
  });
  it("uses the same reserved ARN for shadow preview and eventual creation", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam),
      resources: string[] = [];
    vi.spyOn(iam, "authorizeMany").mockImplementation((input) => {
      resources.push(...input.resources);
      return original(input);
    });
    const created = await save(outsider);
    expect(resources).toContain(platformRelayProbeProfileArn(outsider, created.id));
  });
});
