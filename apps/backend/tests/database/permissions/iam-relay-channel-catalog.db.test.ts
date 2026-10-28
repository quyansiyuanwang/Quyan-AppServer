import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelCatalogIamService } from "@/services/relay/relay-channel-catalog-iam.service";
import { RelayChannelCatalogReadRepository } from "@/store/relay/relay-channel-catalog-read.repository";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayConfigService } from "@/services/relay/relay-config.service";
import { ModelPricingService } from "@/services/relay/model-pricing.service";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { relayChannelSelectionArn } from "@/iam/resources/relay-channel-selection-resources";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:relay:ListChannelCatalog";
let owner: string, actor: string, otherOwner: string, root: string, leaf: string, second: string, prefix: string;
const arn = (id: string) => relayChannelSelectionArn(owner, id);
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const invoke = (req = request()) => RelayChannelService.getInstance().listCatalogOptions(actor, req);
async function policy(
  Resource: string | string[],
  Effect: "Allow" | "Deny" = "Deny",
  Condition?: IamCondition,
  principalType = "user",
  principalId = actor,
) {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Effect, Action: action, Resource, ...(Condition ? { Condition } : {}) },
  });
  const row = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: prefix + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
      policyId: row.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
function intercept(transform?: (rows: unknown[], args: Prisma.RelayChannelFindManyArgs, call: number) => unknown[]) {
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
        const rows = await find(args);
        return transform ? transform(rows, args, reads.length) : rows;
      }) as typeof tx.relayChannel.findMany);
      return callback(tx);
    }, options)) as typeof prisma.$transaction);
  return reads;
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "catalog-" + randomUUID();
  await prisma.relayChannel.deleteMany();
  await prisma.relayConfig.deleteMany();
  const user = async (accountOwnerId?: string) =>
    (
      await prisma.user.create({
        data: {
          username: prefix + randomUUID(),
          password: "fixture-only",
          userType: accountOwnerId ? "ram_user" : "root",
          accountOwnerId,
          parentUserId: accountOwnerId,
          permissionAdds: accountOwnerId ? [Permission.RELAY_TOKEN_READ] : [],
          permissionRemoves: [],
        },
      })
    ).id;
  owner = await user();
  actor = await user(owner);
  otherOwner = await user();
  const channel = async (name: string, data: Prisma.RelayChannelUncheckedCreateInput = { name: "unused" }) =>
    (
      await prisma.relayChannel.create({
        data: {
          ...data,
          name: prefix + name,
          openaiUpstreamApiKey: "fixture-only-secret",
          openaiUpstreamUrl: "https://fixture.invalid/private",
        },
      })
    ).id;
  root = await channel("root", {
    name: "unused",
    channelType: "automatic-proxy-pool",
    routingConfig: { allowedModelsMode: "all" },
  });
  leaf = await channel("leaf", {
    name: "unused",
    channelType: "pooled-member",
    pooledParentId: root,
    multiplier: 2,
    allowedFormats: "openai-chat-completions",
    allowedModels: JSON.stringify([prefix + "model"]),
  });
  second = await channel("second", {
    name: "unused",
    channelType: "pooled-member",
    pooledParentId: root,
    multiplier: 7,
    allowedFormats: "anthropic",
    allowedModels: JSON.stringify([prefix + "other"]),
  });
  await prisma.relayChannelMember.createMany({
    data: [
      { relayChannelId: root, memberChannelId: leaf, priority: 1, enabled: true },
      { relayChannelId: root, memberChannelId: second, priority: 2, enabled: true },
    ],
  });
  await prisma.modelPricing.createMany({
    data: [
      {
        model: prefix + "model",
        provider: prefix + "request",
        supportedFormats: "openai-chat-completions",
        inputPrice: 1,
        outputPrice: 2,
      },
      {
        model: prefix + "other",
        provider: prefix + "other-request",
        supportedFormats: "anthropic",
        inputPrice: 1,
        outputPrice: 2,
      },
    ],
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.relayChannel.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, otherOwner] } } });
  await prisma.group.deleteMany({ where: { accountOwnerId: owner } });
});
describe("native consumer channel catalog", () => {
  it("publishes safe path-correlated model ranges without management rights or rich reads", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listActive"),
      broad = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig"),
      prices = vi.spyOn(ModelPricingService.getInstance(), "getModelPricing"),
      preload = vi.spyOn(RelayPoolResolverService.getInstance(), "preloadContext");
    const reads = intercept(),
      result = await invoke();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: root,
      pricingMode: "range",
      priceMayVary: true,
      modelPriceRanges: [
        { catalogModelName: prefix + "model", requestModelId: prefix + "request", minMultiplier: 2, maxMultiplier: 2 },
        {
          catalogModelName: prefix + "other",
          requestModelId: prefix + "other-request",
          minMultiplier: 7,
          maxMultiplier: 7,
        },
      ],
    });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(
      /fixture-only-secret|fixture.invalid|poolMembers|routingConfig|modelMapping|visibilityConfig|pooledParent/,
    );
    for (const spy of [rich, broad, prices, preload]) expect(spy).not.toHaveBeenCalled();
    expect(reads.length).toBeGreaterThan(2);
    for (const read of reads) {
      expect(read.include).toBeUndefined();
      expect(read.select).toBeDefined();
      expect(Object.keys(read.select!)).not.toEqual(expect.arrayContaining(["openaiUpstreamApiKey"]));
      expect(Object.keys(read.select!).some((key) => /Upstream|providers|submittedBy/.test(key))).toBe(false);
    }
  });
  it("does not combine models and formats from separate member paths", async () => {
    const row = (await invoke())[0]!;
    expect(row.modelCapabilities).toEqual([
      {
        catalogModelName: prefix + "model",
        requestModelId: prefix + "request",
        supportedRequestFormats: ["openai-chat-completions"],
      },
      {
        catalogModelName: prefix + "other",
        requestModelId: prefix + "other-request",
        supportedRequestFormats: ["anthropic"],
      },
    ]);
  });
  it("removes an explicitly denied member from capability and price computation", async () => {
    await policy(arn(second));
    const rows = intercept(),
      result = await invoke();
    expect(result[0]!.modelCapabilities).toHaveLength(1);
    expect(result[0]!.modelPriceRanges).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(prefix + "other");
    for (const row of rows.filter((row) => row.select?.name)) expect(JSON.stringify(row.where)).not.toContain(second);
  });
  it("does not hydrate anything when every resource is denied", async () => {
    await policy("*");
    const rows = intercept();
    expect(await invoke()).toEqual([]);
    expect(rows.every((row) => row.select?.name !== true && row.select?.visibilityConfig !== true)).toBe(true);
  });
  it("does not use an account ARN as an alternative to the denied concrete view", async () => {
    expect(() =>
      parseIamPolicy({
        Version: "1",
        Statement: { Effect: "Allow", Action: action, Resource: `acs:quyan:*:${owner}:account` },
      }),
    ).toThrow();
    await policy(arn(root));
    expect(await invoke()).toEqual([]);
  });
  it("defaults to empty when no Allow exists", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    expect(await invoke()).toEqual([]);
  });
  it("supports a JSON-only account-local channel view grant", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await policy([arn(root), arn(leaf)], "Allow");
    expect((await invoke())[0]!.modelCapabilities).toHaveLength(1);
  });
  it("does not accept another account's channel-view grants", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await policy(relayChannelSelectionArn(otherOwner, root), "Allow");
    await expect(invoke()).rejects.toThrow("Invalid IAM policy document");
  });
  it("legacy removal is an explicit Deny even with JSON Allow", async () => {
    await policy("*", "Allow");
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.RELAY_TOKEN_READ] } });
    expect(await invoke()).toEqual([]);
  });
  it.each(["hidden", "whitelist"])("excludes %s members before model or price reads", async (visibilityMode) => {
    await prisma.relayChannel.update({ where: { id: second }, data: { visibilityMode, visibilityConfig: {} } });
    const rows = intercept();
    expect((await invoke())[0]!.modelCapabilities).toHaveLength(1);
    for (const row of rows.filter((row) => row.select?.name)) expect(JSON.stringify(row.where)).not.toContain(second);
  });
  it.each([{ status: 2 }, { providerServiceEnabled: false }])("excludes inactive member %j", async (data) => {
    await prisma.relayChannel.update({ where: { id: second }, data });
    expect((await invoke())[0]!.modelCapabilities).toHaveLength(1);
  });
  it("preserves strict member precedence over conflicting legacy membership", async () => {
    await prisma.relayChannel.update({ where: { id: root }, data: { channelType: "pooled" } });
    await prisma.relayChannelMember.updateMany({
      where: { relayChannelId: root, memberChannelId: leaf },
      data: { enabled: false, priority: 99 },
    });
    expect((await invoke())[0]!.modelCapabilities).toHaveLength(2);
  });
  it("bounds cyclic pools without publishing partial data", async () => {
    await prisma.relayChannel.update({ where: { id: leaf }, data: { channelType: "pooled" } });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: leaf, memberChannelId: root, enabled: true, weight: 1, priority: 1 },
    });
    expect(await invoke()).toEqual([]);
  });
  it("does not read a denied root's label or topology", async () => {
    await policy(arn(root));
    const reads = intercept();
    expect(await invoke()).toEqual([]);
    for (const read of reads.filter((row) => row.select?.name)) expect(JSON.stringify(read.where)).not.toContain(root);
  });
  it("checks conditions using trusted transport, ignoring forged client action and identity", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await policy("*", "Allow", {
      IpAddress: { "acs:SourceIp": "127.0.0.1" },
      Bool: { "acs:SecureTransport": true },
    });
    const allowedReq = request();
    const allowedResult = await invoke(allowedReq);
    expect(allowedResult, JSON.stringify(allowedReq.iamDecisions)).toHaveLength(1);
    const req = request();
    Object.defineProperty(req, "ip", { value: "192.0.2.1" });
    expect(await invoke(req)).toEqual([]);
  });
  it("uses the fixed operation even if client headers claim management", async () => {
    const req = request();
    req.headers["x-action"] = "quyan:relay:DeleteChannels";
    await invoke(req);
    expect(req.iamDecisions!.every((row) => row.action === action)).toBe(true);
  });
  it("requires a request in enforce and shadow", async () => {
    await expect(RelayChannelService.getInstance().listCatalogOptions(actor)).rejects.toMatchObject({
      statusCode: 403,
    });
    env.security.iamAuthorizationMode = "shadow";
    await expect(RelayChannelService.getInstance().listCatalogOptions(actor)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects missing or mismatched trusted identity", async () => {
    const req = request();
    req.authContext!.principalUserId = owner;
    await expect(invoke(req)).rejects.toMatchObject({ statusCode: 403 });
    delete req.authContext;
    await expect(invoke(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["mode", "transport", "principal", "key"])(
    "withholds projection when %s changes before return",
    async (change) => {
      const req = request(),
        repository = RelayChannelCatalogReadRepository.getInstance(),
        original = repository.read.bind(repository);
      vi.spyOn(repository, "read").mockImplementation(async (...args) => {
        const result = await original(...args);
        if (change === "mode") env.security.iamAuthorizationMode = "legacy";
        if (change === "transport") Object.defineProperty(req, "ip", { value: "192.0.2.1" });
        if (change === "principal") req.authContext!.accountOwnerId = otherOwner;
        if (change === "key") req.accessKey = { id: "new-key" } as NonNullable<TypedRequest["accessKey"]>;
        return result;
      });
      await expect(invoke(req)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("withholds projection after policy revocation at the final boundary", async () => {
    const repository = RelayChannelCatalogReadRepository.getInstance(),
      original = repository.read.bind(repository);
    vi.spyOn(repository, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      await policy("*");
      return result;
    });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks live conditions at response release, not only the policy hash", async () => {
    const repository = RelayChannelCatalogReadRepository.getInstance(),
      original = repository.read.bind(repository);
    vi.spyOn(repository, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
        input.resources.map(() => ({ decision: "ImplicitDeny", reason: "no-matching-allow", matchedStatements: [] })),
      );
      return result;
    });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("withholds projection after graph source drift", async () => {
    let seen = 0;
    intercept((rows, args) =>
      args.select?.name && ++seen > 1 ? rows.map((row) => ({ ...(row as object), multiplier: 99 })) : rows,
    );
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("returns no projection on database failure, never falling back to rich legacy reads", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listActive");
    vi.spyOn(RelayChannelCatalogReadRepository.getInstance(), "read").mockRejectedValue(
      new Error("fixture-only-failure"),
    );
    await expect(invoke()).rejects.toThrow();
    expect(rich).not.toHaveBeenCalled();
  });
  it("validates role-session authority and rejects expired sessions", async () => {
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
    await policy([arn(root), arn(leaf)], "Allow", undefined, "role", role.id);
    const req = request();
    req.authContext!.assumedRoleId = role.id;
    req.authContext!.roleSessionId = session.id;
    expect((await invoke(req))[0]!.modelCapabilities).toHaveLength(1);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
    await expect(invoke(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["key", "oauth"])("revalidates %s after projection and withholds a revoked result", async (kind) => {
    const req = request();
    let revoke: () => Promise<unknown>;
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
      req.accessKey = { id: key.id } as NonNullable<TypedRequest["accessKey"]>;
      req.authContext!.subjectType = "access_key";
      revoke = () => prisma.accessKey.update({ where: { id: key.id }, data: { status: 0 } });
    } else {
      const client = await prisma.oAuthClient.create({
        data: {
          userId: actor,
          clientId: prefix + randomUUID(),
          name: prefix,
          clientSecretHash: "fixture-hash",
          grantTypes: ["authorization_code"],
          redirectUris: [],
          scopes: [Permission.RELAY_CHANNEL_READ],
          reviewStatus: "approved",
        },
      });
      const token = await prisma.oAuthAccessToken.create({
        data: {
          userId: actor,
          oauthClientId: client.id,
          tokenHash: randomUUID(),
          scopes: [Permission.RELAY_CHANNEL_READ],
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      req.oauthAccessToken = {
        id: token.id,
        oauthClientId: client.id,
        userId: actor,
        scopes: [Permission.RELAY_CHANNEL_READ],
      } as NonNullable<TypedRequest["oauthAccessToken"]>;
      revoke = () => prisma.oAuthClient.update({ where: { id: client.id }, data: { scopes: [] } });
    }
    expect(await invoke(req)).toHaveLength(1);
    const repository = RelayChannelCatalogReadRepository.getInstance(),
      original = repository.read.bind(repository);
    vi.spyOn(repository, "read").mockImplementation(async (...args) => {
      const result = await original(...args);
      await revoke();
      return result;
    });
    await expect(invoke(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["hidden", "anonymous-range"] as const)(
    "preserves %s pool display without granting hidden resources",
    async (apiCatalogPoolVisibility) => {
      await prisma.relayConfig.create({ data: { apiCatalogPoolVisibility } });
      await prisma.relayChannel.update({ where: { id: root }, data: { channelType: "pooled" } });
      expect(await invoke()).toHaveLength(apiCatalogPoolVisibility === "hidden" ? 0 : 1);
      await prisma.relayChannel.update({ where: { id: root }, data: { channelType: "automatic-proxy-pool" } });
      expect(await invoke()).toHaveLength(1);
    },
  );
  it("applies context-dependent prices only to the matching model path", async () => {
    await prisma.relayChannel.update({
      where: { id: leaf },
      data: { contextLengthMultipliers: [{ name: "long", enabled: true, minTokens: 100, multiplier: 3 }] },
    });
    const ranges = (await invoke())[0]!.modelPriceRanges!;
    expect(ranges.find((row) => row.catalogModelName === prefix + "model")).toMatchObject({
      minMultiplier: 2,
      maxMultiplier: 6,
    });
    expect(ranges.find((row) => row.catalogModelName === prefix + "other")).toMatchObject({
      minMultiplier: 7,
      maxMultiplier: 7,
    });
  });
  it("honors account-local group policies and Deny without global management membership", async () => {
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    const group = await prisma.group.create({
      data: { name: prefix, username: prefix, accountOwnerId: owner, permissions: [] },
    });
    await prisma.user.update({ where: { id: actor }, data: { groupId: group.id } });
    await policy([arn(root), arn(leaf)], "Allow", undefined, "group", group.id);
    expect((await invoke())[0]!.modelCapabilities).toHaveLength(1);
    await policy(arn(leaf));
    expect((await invoke())[0]!.modelCapabilities).toHaveLength(0);
  });
  it("returns only admitted standalone roots and preserves fixed pricing", async () => {
    await prisma.relayChannel.update({ where: { id: root }, data: { channelType: "standalone", multiplier: 3 } });
    const result = await invoke();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: root, pricingMode: "fixed", multiplier: 3, priceMayVary: false });
    expect(result[0]).not.toHaveProperty("modelPriceRanges");
  });
  it("rejects late decision drift within the serializable read", async () => {
    let round = 0;
    await expect(
      RelayChannelCatalogReadRepository.getInstance().read(
        { subjectUserId: actor, principalUserId: actor, accountOwnerId: owner, subjectType: "sub_user" },
        async (resources) => resources.map(() => (++round > 3 ? "ExplicitDeny" : "Allow")),
        async () => {},
        async () => [],
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow observes only metadata and returns the single legacy result", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await policy("*");
    const reads = intercept(),
      legacy = vi.fn(async () => []);
    expect(await RelayChannelCatalogIamService.getInstance().read(actor, request(), legacy)).toEqual([]);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(reads.every((read) => !read.select?.name && !read.select?.visibilityConfig)).toBe(true);
  });
  it("legacy does not start native reads", async () => {
    env.security.iamAuthorizationMode = "legacy";
    const native = vi.spyOn(RelayChannelCatalogReadRepository.getInstance(), "read"),
      legacy = vi.fn(async () => []);
    expect(await RelayChannelCatalogIamService.getInstance().read(actor, request(), legacy)).toEqual([]);
    expect(native).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledTimes(1);
  });
});
