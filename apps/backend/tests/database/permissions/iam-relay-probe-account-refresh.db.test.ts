import axios from "axios";
import { RedisService } from "@/services/infrastructure/redis.service";
import { PlatformRelayProbeAccountSessionRepository } from "@/store/relay/platform-relay-probe-account-session.repository";
import { RelayChannelProbeLockService } from "@/services/relay/relay-channel-probe-lock.service";
vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return { ...actual, default: { ...actual.default, request: vi.fn() } };
});
vi.mock("@/util/developer-outbound-url", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/util/developer-outbound-url")>();
  const http = await import("node:http"),
    https = await import("node:https");
  return {
    ...actual,
    assertSafeOutboundUrl: vi.fn(async (url: string) => ({
      url: new URL(url),
      httpAgent: new http.Agent(),
      httpsAgent: new https.Agent(),
    })),
  };
});
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelProbeAccountService } from "@/services/relay/relay-channel-probe-account.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { platformRelayProbeAccountArn } from "@/iam/resources/platform-relay-probe-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { Permission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  service = RelayChannelProbeAccountService.getInstance();
let owner: string, actor: string, groupId: string, accounts: string[], prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
  }) as unknown as TypedRequest;
const input = () => ({
  name: prefix + "updated",
  loginWorkflow: {
    method: "POST" as const,
    url: "https://example.com/login",
    headers: { "x-fixture-secret": "fixture-workflow-secret" },
  },
  tokenPath: "data.token",
  fallbackTtlSeconds: 300,
  minLoginIntervalSeconds: 60,
  credentials: { username: "fixture-user", password: "fixture-password" },
});
const refresh = () => service.refresh(accounts[0]!, request());
const cacheKey = () => "relay:probe-account:v1:session:" + accounts[0];
const originalMasterKey = env.relay.channelProbe.masterKey;
async function policy(effect: "Allow" | "Deny", resource: string) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect: effect, Action: "quyan:relay:RefreshProbeAccount", Resource: resource },
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
  vi.mocked(axios.request)
    .mockReset()
    .mockResolvedValue({ data: { data: { token: "fixture-issued-session", expires_in: 900 } } });
  env.security.iamAuthorizationMode = "enforce";
  env.relay.channelProbe.masterKey = "fixture-probe-encryption-key".repeat(4);
  prefix = "probe-refresh-" + randomUUID();
  accounts = [];
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
        name: "Fixture probe manager",
        accountOwnerId: null,
        permissions: [Permission.RELAY_CHANNEL_PROBE_ACCOUNT_MANAGE],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  for (const name of ["B", "A"])
    accounts.push(
      (
        await prisma.relayChannelProbeAccount.create({
          data: {
            name: prefix + name,
            tokenPath: "data.token",
            fallbackTtlSeconds: 30,
            minLoginIntervalSeconds: 60,
            encryptedCredentials: "fixture-encrypted-secret",
            credentialIv: "fixture-iv",
            credentialAuthTag: "fixture-tag",
            lastLoginAttemptAt: new Date(0),
          },
        })
      ).id,
    );
  await service.save({ ...input(), name: prefix + "B" }, accounts[0], request());
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  env.relay.channelProbe.masterKey = originalMasterKey;
  for (const id of accounts) {
    await RedisService.getInstance().delete("relay:probe-account:v1:session:" + id);
    await RedisService.getInstance().delete("relay:probe-account:v1:login:" + id);
  }
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayChannelProbeAccount.deleteMany({
    where: { OR: [{ id: { in: accounts } }, { name: { startsWith: prefix } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: [actor, owner] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("probe account refresh authorization and publication", () => {
  it("refreshes only the permitted account and never returns a session token", async () => {
    const result = await refresh();
    expect(result).toMatchObject({ id: accounts[0], cached: true, hasCredentials: true });
    expect(JSON.stringify(result)).not.toContain("fixture-issued-session");
    expect(JSON.stringify(result)).not.toContain("fixture-password");
    expect(axios.request).toHaveBeenCalledOnce();
    expect(await service.getToken(accounts[0]!)).toBe("fixture-issued-session");
    expect(axios.request).toHaveBeenCalledOnce();
    expect(
      (await prisma.relayChannelProbeAccount.findUniqueOrThrow({ where: { id: accounts[0] } })).lastLoginAttemptAt,
    ).not.toBeNull();
  });
  it("denies before reading credentials, clearing the old cache or contacting upstream", async () => {
    const redis = RedisService.getInstance();
    await redis.set(cacheKey(), "fixture-old-cached-value", 300);
    await policy("Deny", platformRelayProbeAccountArn(accounts[0]!));
    const { RelayChannelProbeAccountRepository } = await import("@/store/relay/relay-channel-probe-account.repository");
    const read = vi.spyOn(RelayChannelProbeAccountRepository.getInstance(), "find");
    await expect(refresh()).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
    expect(axios.request).not.toHaveBeenCalled();
    expect(await redis.get(cacheKey())).toBe("fixture-old-cached-value");
  });
  it("cannot manufacture platform qualification from account policies", async () => {
    await policy("Allow", "*");
    await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    await expect(refresh()).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.request).not.toHaveBeenCalled();
  });
  it("rechecks a grant after waiting for the shared account lock", async () => {
    const iam = IamAuthorizationService.getInstance();
    vi.spyOn(RelayChannelProbeLockService.getInstance(), "withWrite").mockImplementation(async (_key, work) => {
      vi.spyOn(iam, "authorizeMany").mockResolvedValue([
        { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] },
      ]);
      return work();
    });
    await expect(refresh()).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.request).not.toHaveBeenCalled();
  });
  it("does not publish a session when the grant is revoked during upstream login", async () => {
    await refresh();
    const redis = RedisService.getInstance(),
      previous = await redis.get(cacheKey());
    await prisma.relayChannelProbeAccount.update({
      where: { id: accounts[0] },
      data: { lastLoginAttemptAt: new Date(0) },
    });
    vi.mocked(axios.request).mockImplementationOnce(async () => {
      vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockResolvedValue([
        { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] },
      ]);
      return { data: { data: { token: "fixture-revoked-session", expires_in: 900 } } };
    });
    await expect(refresh()).rejects.toMatchObject({ statusCode: 403 });
    expect(await redis.get(cacheKey())).toBe(previous);
  });
  it("rejects a principal disabled during upstream login without publishing a session", async () => {
    vi.mocked(axios.request).mockImplementationOnce(async () => {
      await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
      return { data: { data: { token: "fixture-disabled-principal-session", expires_in: 900 } } };
    });
    await expect(refresh()).rejects.toMatchObject({ statusCode: 403 });
    expect(await RedisService.getInstance().get(cacheKey())).toBeNull();
  });
  it.each([false, true])("compensates a revoked publication with previous-session presence %s", async (hasPrevious) => {
    const redis = RedisService.getInstance();
    if (hasPrevious) {
      await refresh();
      await prisma.relayChannelProbeAccount.update({
        where: { id: accounts[0] },
        data: { lastLoginAttemptAt: new Date(0) },
      });
    }
    const previous = await redis.get(cacheKey()),
      iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam),
      set = redis.set.bind(redis);
    let published = false;
    const restore = vi.spyOn(redis, "replaceIfValueMatches");
    vi.spyOn(redis, "set").mockImplementation(async (key, value, ttl) => {
      await set(key, value, ttl);
      if (key === cacheKey()) published = true;
    });
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (args) => {
      const rows = await authorize(args);
      return published ? rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : rows;
    });
    await expect(refresh()).rejects.toMatchObject({ statusCode: 403 });
    expect(published).toBe(true);
    expect(await redis.get(cacheKey())).toBe(previous);
    if (hasPrevious) expect(restore).toHaveBeenCalledOnce();
  });
  it("does not overwrite a newer session during compensation", async () => {
    await refresh();
    await prisma.relayChannelProbeAccount.update({
      where: { id: accounts[0] },
      data: { lastLoginAttemptAt: new Date(0) },
    });
    const redis = RedisService.getInstance(),
      iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam),
      set = redis.set.bind(redis);
    let published = false,
      replaced = false;
    vi.spyOn(redis, "set").mockImplementation(async (key, value, ttl) => {
      await set(key, value, ttl);
      if (key === cacheKey()) published = true;
    });
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (args) => {
      const rows = await authorize(args);
      if (!published) return rows;
      if (!replaced) {
        replaced = true;
        await set(cacheKey(), "fixture-newer-session", 300);
      }
      return rows.map((row) => ({ ...row, decision: "ExplicitDeny" as const }));
    });
    await expect(refresh()).rejects.toMatchObject({ statusCode: 403 });
    expect(await redis.get(cacheKey())).toBe("fixture-newer-session");
  });
  it("retains the old cache and a safe error when upstream login fails", async () => {
    await refresh();
    const redis = RedisService.getInstance(),
      previous = await redis.get(cacheKey());
    await prisma.relayChannelProbeAccount.update({
      where: { id: accounts[0] },
      data: { lastLoginAttemptAt: new Date(0) },
    });
    vi.mocked(axios.request).mockRejectedValueOnce(new Error("fixture-password in upstream error"));
    await expect(refresh()).rejects.toMatchObject({ statusCode: 400 });
    expect(await redis.get(cacheKey())).toBe(previous);
  });
  it("preserves cooldown without dispatching an upstream login", async () => {
    await prisma.relayChannelProbeAccount.update({
      where: { id: accounts[0] },
      data: { lastLoginAttemptAt: new Date() },
    });
    await expect(refresh()).rejects.toMatchObject({ statusCode: 400 });
    expect(axios.request).not.toHaveBeenCalled();
  });
  it("uses a metadata-only shadow preview before exactly one legacy refresh", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const repo = PlatformRelayProbeAccountSessionRepository.getInstance(),
      inspect = vi.spyOn(repo, "inspect"),
      attempt = vi.spyOn(repo, "recordAttempt"),
      publish = vi.spyOn(repo, "publish");
    expect(await refresh()).toMatchObject({ id: accounts[0], cached: true });
    expect(inspect).toHaveBeenCalledOnce();
    expect(attempt).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(axios.request).toHaveBeenCalledOnce();
  });
  it.each(["legacy", "shadow"] as const)("keeps the legacy refresh result in %s", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    await policy("Deny", "*");
    expect(await refresh()).toMatchObject({ id: accounts[0], cached: true });
    expect(axios.request).toHaveBeenCalledOnce();
  });
});
