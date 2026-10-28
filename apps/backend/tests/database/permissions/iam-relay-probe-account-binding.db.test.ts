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
let standaloneProfile: string;
const masterKey = env.relay.channelProbe.masterKey;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const bind = (accountId: string | null, channelId = standalone, memberChannelId?: string) =>
  RelayChannelProbeService.getInstance().bindAccounts(
    { targets: [{ channelId, ...(memberChannelId ? { memberChannelId } : {}), accountId }] },
    actor,
    request(),
  );
let accountId: string | undefined;
let extraAccounts: string[] = [];
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

async function policy(effect: "Allow" | "Deny", resource: string, action = "quyan:relay:BindProbeAccount") {
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
  prefix = "probe-account-binding-" + randomUUID();
  channelIds = [];
  accountId = undefined;
  extraAccounts = [];
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
        permissions: [Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE],
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
  await prisma.relayChannelProbeAccount.deleteMany({
    where: { id: { in: [...extraAccounts, ...(accountId ? [accountId] : [])] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});

async function account() {
  const row = await prisma.relayChannelProbeAccount.create({
    data: {
      name: prefix + randomUUID(),
      tokenPath: "data.token",
      fallbackTtlSeconds: 30,
      minLoginIntervalSeconds: 60,
      encryptedCredentials: "fixture-must-not-load",
      credentialIv: "fixture-iv",
      credentialAuthTag: "fixture-tag",
    },
  });
  extraAccounts.push(row.id);
  return row.id;
}
const stored = (channelId = standalone, targetId = channelId) =>
  prisma.relayChannelProbeTargetConfig.findFirst({
    where: { profile: { relayChannelId: channelId }, targetChannelId: targetId },
  });
describe("resource-authorized shared probe account bindings", () => {
  it("binds using dedicated account-manager qualification, without granting general probe execution", async () => {
    const id = await account(),
      result = await bind(id);
    expect(result.rejected).toEqual([]);
    expect(result.configured).toEqual([{ channelId: standalone, accountId: id }]);
    expect((await stored())?.accountId).toBe(id);
    expect(JSON.stringify(result)).not.toContain("fixture-must-not-load");
  });
  it.each(["channel", "profile", "account"])(
    "refuses a deny on the %s resource without writing a binding",
    async (kind) => {
      const id = await account();
      await policy(
        "Deny",
        kind === "channel"
          ? platformRelayChannelArn(standalone)
          : kind === "profile"
            ? platformRelayProbeProfileArn(standalone, standaloneProfile)
            : platformRelayProbeAccountArn(id),
      );
      const result = await bind(id);
      expect(result.configured).toEqual([]);
      expect(result.rejected).toHaveLength(1);
      expect(await stored()).toBeNull();
    },
  );
  it("replacing an account requires old-account Unbind and new-account Bind grants", async () => {
    const old = await bindAccount(),
      next = await account();
    await policy("Deny", platformRelayProbeAccountArn(old), "quyan:relay:UnbindProbeAccount");
    expect((await bind(next)).configured).toEqual([]);
    expect((await stored())?.accountId).toBe(old);
    expect((await bind(null)).configured).toEqual([]);
    expect((await stored())?.accountId).toBe(old);
  });
  it("new-account deny cannot be bypassed by replacing a previous binding", async () => {
    const old = await bindAccount(),
      next = await account();
    await policy("Deny", platformRelayProbeAccountArn(next));
    expect((await bind(next)).configured).toEqual([]);
    expect((await stored())?.accountId).toBe(old);
  });
  it("explicitly unbinds without destroying target-specific settings", async () => {
    await bindAccount();
    await prisma.relayChannelProbeTargetConfig.updateMany({
      where: { profileId: standaloneProfile },
      data: { probeModel: "keep-target-model", probeGroup: "keep-group" },
    });
    const result = await bind(null);
    expect(result.configured).toEqual([{ channelId: standalone }]);
    expect(await stored()).toMatchObject({
      accountId: null,
      probeModel: "keep-target-model",
      probeGroup: "keep-group",
    });
  });
  it("an idempotent same-account bind does not require unrelated unbind authority", async () => {
    const id = await bindAccount();
    await policy("Deny", platformRelayProbeAccountArn(id), "quyan:relay:UnbindProbeAccount");
    expect((await bind(id)).configured).toHaveLength(1);
  });
  it("retains independent successful targets when another target is denied", async () => {
    const id = await account();
    await policy("Deny", platformRelayChannelArn(member));
    const result = await RelayChannelProbeService.getInstance().bindAccounts(
      {
        targets: [
          { channelId: pool, memberChannelId: member, accountId: id },
          { channelId: standalone, accountId: id },
        ],
      },
      actor,
      request(),
    );
    expect(result.configured).toHaveLength(1);
    expect(result.configured[0]!.channelId).toBe(standalone);
    expect(result.rejected).toHaveLength(1);
  });
  it("protects pooled members and rejects disabled legacy-only targets", async () => {
    const id = await account();
    expect((await bind(id, pool, member)).configured).toHaveLength(1);
    await prisma.relayChannel.update({ where: { id: member }, data: { pooledParentId: null } });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: pool, memberChannelId: member, enabled: false, priority: 0 },
    });
    expect((await bind(id, pool, member)).configured).toEqual([]);
  });
  it("strict topology existence prevents fallback to foreign legacy members", async () => {
    const id = await account();
    await prisma.relayChannelMember.create({ data: { relayChannelId: pool, memberChannelId: outsider, priority: 0 } });
    expect((await bind(id, pool, outsider)).configured).toEqual([]);
    expect(await stored(pool, outsider)).toBeNull();
  });
  it("active probe work prevents binding changes", async () => {
    const id = await account();
    await prisma.relayChannelProbeRun.create({
      data: {
        relayChannelId: standalone,
        profileId: standaloneProfile,
        requestedByUserId: actor,
        distributionMultiplier: 1,
      },
    });
    expect((await bind(id)).configured).toEqual([]);
    expect(await stored()).toBeNull();
  });
  it("requires persisted global account-manager membership even with a wildcard policy", async () => {
    const id = await account();
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.RELAY_CHANNEL_PROBE_EXECUTE] },
    });
    await policy("Allow", "*");
    await expect(bind(id)).rejects.toMatchObject({ statusCode: 403 });
    expect(await stored()).toBeNull();
  });
  it("rechecks membership after waiting on the shared channel lock", async () => {
    const id = await account(),
      locks = RelayChannelProbeLockService.getInstance(),
      original = locks.withWrite.bind(locks);
    vi.spyOn(locks, "withWrite").mockImplementation(async (channelId, operation, timeout) => {
      await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      return original(channelId, operation, timeout);
    });
    expect((await bind(id)).configured).toEqual([]);
    expect(await stored()).toBeNull();
  });
  it("rolls back a written replacement when old-account unbind is revoked at commit", async () => {
    const old = await bindAccount(),
      next = await account(),
      transaction = prisma.$transaction.bind(prisma);
    let changed = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) =>
      transaction(async (tx) => {
        const write = tx.relayChannelProbeTargetConfig.upsert.bind(tx.relayChannelProbeTargetConfig);
        vi.spyOn(tx.relayChannelProbeTargetConfig, "upsert").mockImplementation((args) => {
          changed = true;
          return write(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      return changed && input.action === "quyan:relay:UnbindProbeAccount"
        ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const }))
        : rows;
    });
    expect((await bind(next)).configured).toEqual([]);
    expect(changed).toBe(true);
    expect((await stored())?.accountId).toBe(old);
  });
  it("unknown accounts cannot create orphan bindings", async () => {
    expect((await bind("fixture-missing-account")).configured).toEqual([]);
    expect(await stored()).toBeNull();
  });
  it("shadow native preview does not persist and legacy binds exactly once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const id = await account();
    const repository = (
      await import("@/store/relay/relay-channel-probe-account.repository")
    ).RelayChannelProbeAccountRepository.getInstance();
    const legacy = vi.spyOn(repository, "upsertTarget");
    const result = await bind(id);
    expect(result.configured).toHaveLength(1);
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("requires authenticated context, unique targets and matching actor", async () => {
    const id = await account(),
      service = RelayChannelProbeService.getInstance();
    await expect(
      service.bindAccounts({ targets: [{ channelId: standalone, accountId: id }] }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.bindAccounts(
        {
          targets: [
            { channelId: standalone, accountId: id },
            { channelId: standalone, accountId: null },
          ],
        },
        actor,
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.bindAccounts({ targets: [{ channelId: standalone, accountId: id }] }, owner, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
