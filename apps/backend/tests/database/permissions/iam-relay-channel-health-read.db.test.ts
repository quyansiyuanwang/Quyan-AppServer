import { Prisma } from "@prisma/client";
import {
  RelayChannelHealthReadRepository,
  relayChannelHealthReadSelect,
} from "@/store/relay/relay-channel-health-read.repository";
import { RelayChannelHealthService } from "@/services/relay/relay-channel-health.service";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:ListChannelHealth",
  mode = env.security.iamAuthorizationMode;
let owner: string, actor: string, groupId: string, root: string, leaf: string, pool: string, prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const overview = (req = request()) => RelayChannelService.getInstance().getChannelHealthOverview(actor, req);
const get = (id = leaf, req = request()) => RelayChannelService.getInstance().getChannelHealth(id, actor, req);
const automatic = (req = request()) => RelayChannelService.getInstance().getAutomaticPoolHealths(actor, req);
async function grant(
  resources: string[],
  Effect: "Allow" | "Deny" = "Deny",
  principal = { type: "user", id: actor },
  Action = action,
  Condition?: IamCondition,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect, Action, Resource: resources, ...(Condition ? { Condition } : {}) },
  });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: prefix + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: principal.type,
      principalId: principal.id,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "health-iam-" + randomUUID();
  await prisma.relayChannel.deleteMany();
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: prefix + randomUUID(),
          password: "fixture-only",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
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
        name: prefix,
        username: prefix,
        accountOwnerId: null,
        permissions: [Permission.RELAY_CHANNEL_HEALTH_READ, Permission.RELAY_CHANNEL_POOL_METADATA_READ],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  root = (
    await prisma.relayChannel.create({
      data: { name: prefix + "root", channelType: "pooled", openaiUpstreamApiKey: "fixture-secret" },
    })
  ).id;
  leaf = (
    await prisma.relayChannel.create({
      data: {
        name: prefix + "leaf",
        channelType: "standalone",
        routingConfig: { healthTrackingMode: "manual", manualAvailability: 0.8, manualLatencyMs: 25 },
      },
    })
  ).id;
  pool = (
    await prisma.relayChannel.create({ data: { name: prefix + "automatic", channelType: "automatic-proxy-pool" } })
  ).id;
  await prisma.relayChannelMember.create({
    data: { relayChannelId: pool, memberChannelId: leaf, priority: 0, weight: 2 },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
});

function intercept(transform?: (rows: unknown[], args: Prisma.RelayChannelFindManyArgs) => unknown[]) {
  const original = prisma.$transaction.bind(prisma),
    reads: Prisma.RelayChannelFindManyArgs[] = [];
  vi.spyOn(prisma, "$transaction").mockImplementation(((
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: object,
  ) =>
    original(async (tx) => {
      const find = tx.relayChannel.findMany.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "findMany").mockImplementation((async (args: Prisma.RelayChannelFindManyArgs) => {
        reads.push(args);
        const result = await find(args);
        return transform ? transform(result, args) : result;
      }) as typeof tx.relayChannel.findMany);
      return callback(tx);
    }, options)) as typeof prisma.$transaction);
  return reads;
}
const hasChannel = (args: Prisma.RelayChannelFindManyArgs, id: string) =>
  (args.where?.id as { in?: string[] } | undefined)?.in?.includes(id);
describe("native resource-scoped channel health reads", () => {
  it("reads safe health configuration and preserves manual and automatic projections", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listVisible"),
      find = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById");
    const reads = intercept();
    expect(await overview()).toMatchObject({
      windowMinutes: 15,
      channels: [{ channelId: leaf, name: prefix + "leaf", availability: 0.8, averageLatencyMs: 25, source: "manual" }],
    });
    expect(await get()).toMatchObject({ channelId: leaf, trackingMode: "manual", availability: 0.8 });
    expect(await get(root)).toMatchObject({ channelId: root, trackingMode: "automatic" });
    expect(await get(pool)).toMatchObject({
      channelId: pool,
      members: [{ channelId: leaf, name: prefix + "leaf", weight: 2, source: "manual" }],
    });
    expect(await automatic()).toEqual([expect.objectContaining({ channelId: pool })]);
    expect(rich).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    for (const args of reads) {
      expect(args.include).toBeUndefined();
      expect(args.select).toBeDefined();
      expect(JSON.stringify(args.select)).not.toMatch(
        /Upstream|providers|password|modelMapping|allowedModels|inputPrice|outputPrice/,
      );
    }
    expect(relayChannelHealthReadSelect).not.toHaveProperty("openaiUpstreamApiKey");
  });
  it("loads only returned roots and direct admitted ranking members, not unrelated allowed payloads", async () => {
    const reads = intercept();
    await get();
    for (const args of reads.filter((args) => args.select?.name)) {
      expect(hasChannel(args, leaf)).toBe(true);
      expect(hasChannel(args, root)).not.toBe(true);
      expect(hasChannel(args, pool)).not.toBe(true);
    }
    vi.restoreAllMocks();
    const automaticReads = intercept();
    await automatic();
    for (const args of automaticReads.filter((args) => args.select?.name))
      expect(hasChannel(args, root)).not.toBe(true);
  });
  it("filters overview rows before Redis and never hydrates denied configuration", async () => {
    await grant([platformRelayChannelArn(leaf)]);
    const reads = intercept(),
      health = vi.spyOn(RelayChannelHealthService.getInstance(), "getHealthMap");
    expect(await overview()).toEqual({ windowMinutes: 15, channels: [] });
    expect(health).toHaveBeenCalledWith([], expect.any(Date));
    for (const args of reads.filter((args) => args.select?.name || args.select?.visibilityConfig))
      expect(hasChannel(args, leaf)).not.toBe(true);
  });
  it.each(["primary", "metadata"])(
    "does not expose automatic member names, health or ranks denied by %s Action",
    async (kind) => {
      await grant(
        [platformRelayChannelArn(leaf)],
        "Deny",
        { type: "user", id: actor },
        kind === "primary" ? "quyan:relay:ListAutomaticPoolHealth" : "quyan:relay:ReadChannelPoolHealthMetadata",
      );
      const reads = intercept(),
        ranking = vi.spyOn(RelayChannelHealthService.getInstance(), "rankMembers");
      expect(await automatic()).toEqual([expect.objectContaining({ channelId: pool, members: [] })]);
      expect(ranking.mock.calls.every(([members]) => members.every((member) => member.id !== leaf))).toBe(true);
      for (const args of reads.filter((args) => args.select?.name || args.select?.visibilityConfig))
        expect(hasChannel(args, leaf)).not.toBe(true);
    },
  );
  it("does not treat the metadata Action as a primary health grant", async () => {
    await grant(
      [platformRelayChannelArn(pool)],
      "Deny",
      { type: "user", id: actor },
      "quyan:relay:ListAutomaticPoolHealth",
    );
    expect(await automatic()).toEqual([]);
    expect(await get(pool)).toMatchObject({ channelId: pool });
  });
  it("keeps read actions separate and never allows client metadata to change them", async () => {
    await grant([platformRelayChannelArn(leaf)]);
    const req = request();
    req.headers["x-action"] = "quyan:relay:GetChannelHealth";
    req.query = { action: "*", accountId: owner };
    expect((await overview(req)).channels).toEqual([]);
    expect(req.iamDecisions?.every((row) => row.action === action)).toBe(true);
    expect(await get()).toMatchObject({ channelId: leaf });
  });
  it("evaluates policy conditions from trusted transport, never request query/body", async () => {
    await grant([platformRelayChannelArn(leaf)], "Deny", { type: "user", id: actor }, action, {
      Bool: { "acs:SecureTransport": false },
    });
    const secure = request();
    secure.query = { "acs:SecureTransport": "false" };
    expect((await overview(secure)).channels).toHaveLength(1);
    const insecure = request();
    Object.defineProperty(insecure, "secure", { value: false });
    Object.defineProperty(insecure, "body", { value: { Condition: { "acs:SecureTransport": true } } });
    insecure.headers["x-action"] = "*";
    expect((await overview(insecure)).channels).toEqual([]);
  });
  it("retains legacy permission removals as explicit Deny despite wildcard grants", async () => {
    await grant(["*"], "Allow", { type: "user", id: actor }, "quyan:relay:*");
    await prisma.user.update({
      where: { id: actor },
      data: { permissionRemoves: [Permission.RELAY_CHANNEL_HEALTH_READ] },
    });
    expect((await overview()).channels).toEqual([]);
    expect(await automatic()).toEqual([]);
    await expect(get()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["denied", "missing", "deleted", "private"])("returns a safe uniform 403 on %s detail", async (kind) => {
    if (kind === "denied")
      await grant([platformRelayChannelArn(leaf)], "Deny", { type: "user", id: actor }, "quyan:relay:GetChannelHealth");
    if (kind === "deleted")
      await prisma.relayChannel.update({ where: { id: leaf }, data: { status: RELAY_CHANNEL_STATUS.DELETED } });
    if (kind === "private")
      await prisma.relayChannel.update({ where: { id: leaf }, data: { visibilityMode: "private" } });
    await expect(get(kind === "missing" ? "missing" : leaf)).rejects.toMatchObject({
      statusCode: 403,
      messageKey: "permission.insufficientPermission",
    });
  });
  it("retains health visibility on disabled and provider-paused non-deleted channels", async () => {
    await prisma.relayChannel.update({
      where: { id: leaf },
      data: { status: RELAY_CHANNEL_STATUS.DISABLED, providerServiceEnabled: false },
    });
    expect((await overview()).channels[0]).toMatchObject({ channelId: leaf, enabled: false });
    expect(await get()).toMatchObject({ channelId: leaf });
    expect((await automatic())[0]?.members[0]).toMatchObject({ channelId: leaf, enabled: false, eligible: false });
  });
  it("applies whitelist visibility and does not invent an IAM visibility bypass", async () => {
    await prisma.relayChannel.update({
      where: { id: leaf },
      data: { visibilityMode: "whitelist", visibilityConfig: { userIds: [owner] } },
    });
    expect((await overview()).channels).toEqual([]);
    expect((await automatic())[0]?.members).toEqual([]);
    await prisma.relayChannel.update({ where: { id: leaf }, data: { visibilityConfig: { userIds: [actor] } } });
    expect((await overview()).channels).toHaveLength(1);
  });
  it.each(["health", "metadata", "account-group", "none", "disabled"])(
    "requires persisted deployment qualifications: %s",
    async (kind) => {
      await grant(["*"], "Allow", { type: "user", id: actor }, "quyan:relay:*");
      if (kind === "health")
        await prisma.group.update({
          where: { id: groupId },
          data: { permissions: [Permission.RELAY_CHANNEL_POOL_METADATA_READ] },
        });
      if (kind === "metadata")
        await prisma.group.update({
          where: { id: groupId },
          data: { permissions: [Permission.RELAY_CHANNEL_HEALTH_READ] },
        });
      if (kind === "account-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "none") await prisma.user.update({ where: { id: actor }, data: { groupId: null } });
      if (kind === "disabled") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      await expect(get()).rejects.toMatchObject({ statusCode: 403 });
      await expect(automatic()).rejects.toMatchObject({ statusCode: 403 });
      if (kind === "metadata") expect((await overview()).channels).toHaveLength(1);
      else await expect(overview()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("accepts exact JSON-only policies without global READ or config grants", async () => {
    await grant([platformRelayChannelArn(leaf)], "Allow");
    const iam = IamAuthorizationService.getInstance(),
      original = iam.loadPolicies.bind(iam);
    vi.spyOn(iam, "loadPolicies").mockImplementation(async (p) =>
      (await original(p)).filter((row) => !row.policyId.startsWith("legacy:")),
    );
    expect((await overview()).channels.map((row) => row.channelId)).toEqual([leaf]);
    await expect(get()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves legacy reads once in %s; shadow does not hydrate configuration or Redis",
    async (selected) => {
      env.security.iamAuthorizationMode = "legacy";
      await grant(["*"], "Deny");
      const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listVisible");
      expect((await overview()).channels).toHaveLength(1);
      const baseline = rich.mock.calls.length;
      rich.mockClear();
      env.security.iamAuthorizationMode = selected;
      const native = vi.spyOn(RelayChannelHealthReadRepository.getInstance(), "read");
      expect((await overview()).channels).toHaveLength(1);
      expect(rich).toHaveBeenCalledTimes(baseline);
      expect(native).toHaveBeenCalledTimes(selected === "shadow" ? 1 : 0);
      for (const call of native.mock.calls) expect(call[4]).toBeUndefined();
    },
  );
  it.each(["payload", "relation", "visibility", "channel-type"])(
    "rechecks %s before returning, even without timestamp changes",
    async (kind) => {
      let changed = false;
      intercept((rows, args) => {
        if ((kind === "payload" || kind === "relation") && args.select?.name) {
          if (changed)
            return rows.map((row) => ({
              ...(row as object),
              ...(kind === "payload" ? { name: "changed" } : { poolMembers: [] }),
            }));
          changed = true;
        }
        if (kind === "visibility" && args.select?.visibilityConfig) {
          if (changed) return rows.map((row) => ({ ...(row as object), visibilityMode: "private" }));
          changed = true;
        }
        if (kind === "channel-type" && !args.select?.name && args.select?.channelType) {
          if (changed) return rows.map((row) => ({ ...(row as object), channelType: "unknown" }));
          changed = true;
        }
        return rows;
      });
      await expect(automatic()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it.each(["key", "policy", "group", "principal"])("rejects late %s changes after native reads", async (kind) => {
    const repository = RelayChannelHealthReadRepository.getInstance(),
      original = repository.read.bind(repository),
      req = request();
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
      req.accessKey = { id: key.id } as NonNullable<TypedRequest["accessKey"]>;
      req.authContext!.subjectType = "access_key";
    }
    vi.spyOn(repository, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (kind === "key") await prisma.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
      if (kind === "policy") await grant([platformRelayChannelArn(leaf)]);
      if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      if (kind === "principal") req.authContext!.principalUserId = owner;
      return result;
    });
    await expect(overview(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects missing context, foreign subjects, OAuth and unknown modes", async () => {
    await expect(RelayChannelService.getInstance().getChannelHealthOverview(actor)).rejects.toMatchObject({
      statusCode: 403,
    });
    const req = request();
    req.authContext!.principalUserId = owner;
    await expect(overview(req)).rejects.toMatchObject({ statusCode: 403 });
    const oauth = request();
    oauth.oauthAccessToken = { id: "oauth", userId: actor, oauthClientId: "client" } as NonNullable<
      TypedRequest["oauthAccessToken"]
    >;
    await expect(overview(oauth)).rejects.toMatchObject({ statusCode: 403 });
    env.security.iamAuthorizationMode = "invalid" as typeof env.security.iamAuthorizationMode;
    await expect(overview()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not merge user grants into assumed roles and rechecks session revocation", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } }),
      session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "fixture",
          expiresAt: new Date(Date.now() + 60000),
        },
      });
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    expect((await overview(req)).channels).toEqual([]);
    await grant([platformRelayChannelArn(leaf)], "Allow", { type: "role", id: role.id });
    expect((await overview(req)).channels.map((row) => row.channelId)).toEqual([leaf]);
    await grant(
      [platformRelayChannelArn(leaf)],
      "Allow",
      { type: "role", id: role.id },
      "quyan:relay:GetChannelHealth",
    );
    await expect(get(leaf, req)).rejects.toMatchObject({ statusCode: 403 });
    await grant(
      [platformRelayChannelArn(leaf)],
      "Allow",
      { type: "role", id: role.id },
      "quyan:relay:ReadChannelPoolHealthMetadata",
    );
    expect(await get(leaf, req)).toMatchObject({ channelId: leaf });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(overview(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed when the decision protocol returns a malformed array", async () => {
    vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockResolvedValue([]);
    await expect(overview()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("batches more than one decision window without leaking the denied tail resource", async () => {
    const rows = Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 1 }, (_, index) => ({
      id: "zz-health-" + index,
      name: prefix + index,
      channelType: "standalone",
    }));
    await prisma.relayChannel.createMany({ data: rows });
    await grant([platformRelayChannelArn(rows[rows.length - 1]!.id)]);
    const decide = vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany");
    expect((await overview()).channels).toHaveLength(rows.length);
    expect(
      decide.mock.calls.every(([input]) => input.resources.length <= IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
    ).toBe(true);
  }, 20000);
});
