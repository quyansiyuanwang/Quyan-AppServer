import { randomUUID, createCipheriv, createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelProbeService } from "@/services/relay/relay-channel-probe.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformRelayProbeProfileArn } from "@/iam/resources/platform-relay-probe-resources";
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
const profile = (id = standalone) => RelayChannelProbeService.getInstance().getProfile(id, actor, request());
async function policy(effect: "Allow" | "Deny", resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:GetProbeProfile", Resource: resource },
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
  prefix = "probe-profile-" + randomUUID();
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
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("probe profile authorization before configuration reads", () => {
  it("returns configured names and public workflow without secret values", async () => {
    const result = await profile();
    expect(result.id).toBe(standaloneProfile);
    expect(result.credentialNames).toEqual(["apiKey"]);
    expect(result.probeModel).toBe("fixture-model");
    expect(result.workflow).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("fixture-private-credential");
    expect(result).not.toHaveProperty("encryptedCredentials");
  });
  it("requires both channel and exact profile grants", async () => {
    await policy("Deny", platformRelayProbeProfileArn(standalone, standaloneProfile));
    await expect(profile()).rejects.toMatchObject({ statusCode: 403 });
    await policy("Deny", platformRelayChannelArn(pool));
    await expect(profile(pool)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never loads encrypted credentials or workflow for a denied profile", async () => {
    await policy("Deny", platformRelayProbeProfileArn(standalone, standaloneProfile));
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
    await expect(profile()).rejects.toMatchObject({ statusCode: 403 });
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every((args) => args.select && !args.select.encryptedCredentials && !args.select.workflow && !args.include),
    ).toBe(true);
  });
  it("does not expose credential names for members outside the current pool", async () => {
    expect((await profile(pool)).credentialNames).toEqual([member]);
  });
  it("filters denied member names even when the parent profile is readable", async () => {
    await policy("Deny", platformRelayChannelArn(member));
    expect((await profile(pool)).credentialNames).toEqual([]);
  });
  it("requires deployment qualification independently of account policies", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await policy("Allow", "*");
    await expect(profile()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["private", "hidden"])("retains %s channel visibility", async (visibilityMode) => {
    await prisma.relayChannel.update({ where: { id: standalone }, data: { visibilityMode } });
    await expect(profile()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not return a profile when a grant is revoked at the final check", async () => {
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const rows = await original(input);
      return ++count > 2 ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : rows;
    });
    await expect(profile()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on corrupt encrypted data after authorization", async () => {
    await prisma.relayChannelProbeProfile.update({
      where: { id: standaloneProfile },
      data: { encryptedCredentials: "invalid-ciphertext" },
    });
    await expect(profile()).rejects.toThrow();
    await policy("Deny", platformRelayProbeProfileArn(standalone, standaloneProfile));
    await expect(profile()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("returns the existing missing-profile error only after channel authorization", async () => {
    await expect(profile(outsider)).rejects.toMatchObject({ statusCode: 404 });
  });
  it.each(["legacy", "shadow"] as const)("preserves the original profile in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await policy("Deny", platformRelayProbeProfileArn(pool, poolProfile));
    expect((await profile(pool)).credentialNames).toEqual([member, outsider]);
  });
});
