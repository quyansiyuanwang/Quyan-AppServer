import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { Permission, RELAY_CHANNEL_STATUS, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import {
  RelayChannelConfigurationReadRepository,
  relayChannelConfigurationReadSelect,
} from "@/store/relay/relay-channel-configuration-read.repository";
import type {
  RelayChannelConfigurationReadOptions,
  RelayChannelConfigurationReadSnapshot,
} from "@/store/relay/relay-channel-configuration-read.repository";
import { projectRelayChannelConfiguration } from "@/services/relay/relay-channel-configuration-projection";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";

let owner: string, actor: string, groupId: string, root: string, leaf: string, prefix: string;
const repository = RelayChannelConfigurationReadRepository.getInstance();
const principal = (): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId: owner,
  subjectType: "sub_user",
});
const decide = vi.fn(async (resources: readonly string[]) => resources.map(() => "Allow"));
const recheck = vi.fn(async () => {});
const project = async ({ records, context }: RelayChannelConfigurationReadSnapshot) =>
  Promise.all(
    records.map(async ({ source, presence }) => ({
      ...projectRelayChannelConfiguration(source, presence),
      allowedModels: [
        ...new Set(
          (await RelayPoolResolverService.getInstance().resolveChannelCapabilities(source.id, context)).map(
            (value) => value.catalogModelName,
          ),
        ),
      ].sort(),
    })),
  );
const read = (options: Partial<RelayChannelConfigurationReadOptions> = {}) =>
  repository.read(principal(), { includeDisabled: false, ...options }, decide, recheck, project);
const deny = (id: string) =>
  decide.mockImplementation(async (resources) =>
    resources.map((resource) => (resource === platformRelayChannelArn(id) ? "ExplicitDeny" : "Allow")),
  );
function interceptReads(
  transform?: (rows: unknown[], args: Prisma.RelayChannelFindManyArgs) => unknown[],
  transformSql?: (rows: unknown[], call: number) => unknown[],
) {
  const original = prisma.$transaction.bind(prisma),
    reads: Prisma.RelayChannelFindManyArgs[] = [],
    sql: { text: string; rows: unknown[] }[] = [];
  vi.spyOn(prisma, "$transaction").mockImplementation(((
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: object,
  ) =>
    original(async (tx) => {
      const find = tx.relayChannel.findMany.bind(tx.relayChannel),
        query = (
          vi.isMockFunction(tx.$queryRaw) ? vi.mocked(tx.$queryRaw).getMockImplementation()! : tx.$queryRaw
        ).bind(tx);
      vi.spyOn(tx.relayChannel, "findMany").mockImplementation((async (args: Prisma.RelayChannelFindManyArgs) => {
        reads.push(args);
        const result = await find(args);
        return transform ? transform(result, args) : result;
      }) as typeof tx.relayChannel.findMany);
      vi.spyOn(tx, "$queryRaw").mockImplementation((async (value: Prisma.Sql) => {
        let result = await query(value);
        if (transformSql) result = transformSql(result as unknown[], sql.length);
        sql.push({ text: value.sql, rows: result as unknown[] });
        return result;
      }) as typeof tx.$queryRaw);
      return callback(tx);
    }, options)) as typeof prisma.$transaction);
  return { reads, sql };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  decide.mockReset();
  recheck.mockReset();
  decide.mockImplementation(async (resources) => resources.map(() => "Allow"));
  recheck.mockResolvedValue(undefined);
  prefix = "channel-read-" + randomUUID();
  await prisma.relayChannel.deleteMany();
  owner = (
    await prisma.user.create({
      data: {
        username: prefix + "owner",
        password: "fixture-only",
        userType: "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  groupId = (
    await prisma.group.create({
      data: { name: prefix, username: prefix, accountOwnerId: null, permissions: [Permission.RELAY_CHANNEL_READ] },
    })
  ).id;
  actor = (
    await prisma.user.create({
      data: {
        username: prefix + "actor",
        password: "fixture-only",
        userType: "ram_user",
        accountOwnerId: owner,
        parentUserId: owner,
        groupId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
  root = (
    await prisma.relayChannel.create({
      data: {
        name: prefix + "root",
        channelType: "pooled",
        openaiUpstreamApiKey: "fixture-secret",
        anthropicUpstreamApiKey: "",
        geminiUpstreamApiKey: null,
      },
    })
  ).id;
  leaf = (
    await prisma.relayChannel.create({
      data: {
        name: prefix + "leaf",
        channelType: "pooled-member",
        pooledParentId: root,
        allowedFormats: "openai-chat-completions",
        allowedModels: JSON.stringify([prefix]),
      },
    })
  ).id;
  await prisma.modelPricing.create({
    data: {
      model: prefix,
      provider: prefix,
      inputPrice: 0,
      outputPrice: 0,
      supportedFormats: "openai-chat-completions",
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});
describe("resource-admitted credential-free channel configurations", () => {
  it("preserves safe configuration and effective strict members without loading credentials or prices", async () => {
    const { reads, sql } = interceptReads();
    const result = await read();
    expect(result?.find((row) => row.id === root)).toMatchObject({
      name: prefix + "root",
      hasOpenaiUpstreamApiKey: true,
      hasAnthropicUpstreamApiKey: false,
      hasGeminiUpstreamApiKey: false,
      allowedModels: [prefix],
      poolMembers: [{ memberChannelId: leaf, memberChannelName: prefix + "leaf" }],
    });
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(reads.length).toBeGreaterThan(0);
    for (const args of reads) {
      expect(args.include).toBeUndefined();
      expect(args.select).toBeDefined();
      expect(JSON.stringify(args.select)).not.toMatch(/UpstreamApiKey|inputPrice|outputPrice|password/);
    }
    expect(relayChannelConfigurationReadSelect).not.toHaveProperty("openaiUpstreamApiKey");
    expect(sql).toHaveLength(2);
    for (const query of sql) {
      expect(query.text).toContain("IS NOT NULL");
      for (const row of query.rows)
        expect(Object.keys(row as object).sort()).toEqual(["anthropic", "gemini", "id", "openai"]);
      expect(
        JSON.stringify(query.rows, (_, value) => (typeof value === "bigint" ? Number(value) : value)),
      ).not.toContain("fixture-secret");
    }
  });
  it("strips unknown stored configuration fields on actual authorized reads", async () => {
    await prisma.relayChannel.update({
      where: { id: root },
      data: {
        routingConfig: {
          maxRetries: 2,
          retryStatusCodes: [429, "/^50[234]$/"],
          legacySecret: "fixture-secret-routing",
        },
        visibilityConfig: { userIds: [actor], token: "fixture-secret-visibility" },
        timePeriodMultipliers: [
          {
            name: "night",
            enabled: true,
            dayOfWeek: "1",
            startTime: "01:00",
            endTime: "02:00",
            multiplier: 2,
            credential: "fixture-secret-time",
          },
        ],
        contextLengthMultipliers: [
          { name: "large", enabled: true, minTokens: 1000, multiplier: 2, password: "fixture-secret-context" },
        ],
      },
    });
    const result = (await read({ id: root }))![0]!;
    expect(result.routingConfig).toEqual({ maxRetries: 2, retryStatusCodes: [429, "/^50[234]$/"] });
    expect(result.visibilityConfig).toEqual({ userIds: [actor] });
    expect(result.timePeriodMultipliers?.[0]).not.toHaveProperty("credential");
    expect(result.contextLengthMultipliers?.[0]).not.toHaveProperty("password");
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    // Projection must not mutate persisted configuration as an incidental read.
    expect(
      (await prisma.relayChannel.findUniqueOrThrow({ where: { id: root }, select: { routingConfig: true } }))
        .routingConfig,
    ).toHaveProperty("legacySecret", "fixture-secret-routing");
  });
  it("rejects malformed registered stored fields without echoing their values", async () => {
    await prisma.relayChannel.update({
      where: { id: root },
      data: { routingConfig: { maxRetries: -1, legacySecret: "fixture-secret-invalid" } },
    });
    await expect(read({ id: root })).rejects.toMatchObject({
      statusCode: 403,
      messageKey: "permission.insufficientPermission",
    });
  });
  it("matches nonempty credential presence without MySQL whitespace collation ambiguities", async () => {
    await prisma.relayChannel.update({
      where: { id: root },
      data: { openaiUpstreamApiKey: " ", anthropicUpstreamApiKey: "", geminiUpstreamApiKey: null },
    });
    expect((await read({ id: root }))?.[0]).toMatchObject({
      hasOpenaiUpstreamApiKey: true,
      hasAnthropicUpstreamApiKey: false,
      hasGeminiUpstreamApiKey: false,
    });
  });
  it.each(["malformed", "missing", "duplicate", "foreign", "changed"])(
    "rejects %s credential-presence results",
    async (kind) => {
      interceptReads(undefined, (rows, call) => {
        if (kind === "changed" && call === 0) return rows;
        if (kind === "missing") return [];
        if (kind === "duplicate") return rows.map(() => rows[0]);
        return rows.map((row) => ({
          ...(row as object),
          ...(kind === "foreign" ? { id: "foreign" } : { openai: kind === "malformed" ? "fixture-secret" : 0 }),
        }));
      });
      await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("never hydrates a denied configuration and drops its parent/member references and capabilities", async () => {
    deny(leaf);
    const { reads } = interceptReads();
    const result = await read();
    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({ id: root, allowedModels: [], poolMembers: [] });
    for (const args of reads.filter((args) => args.select?.name || args.select?.visibilityConfig))
      expect((args.where?.id as { in?: string[] }).in).not.toContain(leaf);
    vi.restoreAllMocks();
    deny(root);
    const onlyLeaf = await read({ id: leaf });
    expect(onlyLeaf?.[0]).toMatchObject({ id: leaf });
    expect(onlyLeaf?.[0]?.pooledParentId).toBeUndefined();
    expect(onlyLeaf?.[0]?.pooledParentName).toBeUndefined();
  });
  it.each(["denied", "missing", "deleted", "private"])(
    "returns indistinguishable forbidden for %s single resources",
    async (kind) => {
      if (kind === "denied") deny(root);
      if (kind === "deleted")
        await prisma.relayChannel.update({ where: { id: root }, data: { status: RELAY_CHANNEL_STATUS.DELETED } });
      if (kind === "private")
        await prisma.relayChannel.update({ where: { id: root }, data: { visibilityMode: "private" } });
      await expect(read({ id: kind === "missing" ? "missing-resource" : root })).rejects.toMatchObject({
        statusCode: 403,
        messageKey: "permission.insufficientPermission",
      });
    },
  );
  it("does not load configuration, graph, catalog or credential presence in shadow observation", async () => {
    const { reads, sql } = interceptReads();
    expect(await repository.read(principal(), { includeDisabled: true }, decide, recheck)).toBeUndefined();
    expect(
      reads.every((args) =>
        Object.keys(args.select ?? {}).every((key) =>
          ["id", "status", "providerServiceEnabled", "createTime", "updateTime"].includes(key),
        ),
      ),
    ).toBe(true);
    expect(sql).toEqual([]);
  });
  it("returns an empty list for default deny without payload reads", async () => {
    decide.mockImplementation(async (resources) => resources.map(() => "ImplicitDeny"));
    const { reads, sql } = interceptReads();
    expect(await read()).toEqual([]);
    expect(reads.every((args) => !args.select?.name && !args.select?.visibilityConfig)).toBe(true);
    expect(sql).toEqual([]);
  });
  it.each(["disabled", "paused"])(
    "excludes %s roots/capabilities by default but includes metadata on get",
    async (kind) => {
      await prisma.relayChannel.update({
        where: { id: leaf },
        data: kind === "disabled" ? { status: RELAY_CHANNEL_STATUS.DISABLED } : { providerServiceEnabled: false },
      });
      const regular = await read();
      expect(regular?.map((row) => row.id)).toEqual([root]);
      expect(regular?.[0]?.allowedModels).toEqual([]);
      expect((await read({ id: leaf }))?.[0]).toMatchObject({ id: leaf, serviceEnabled: false, allowedModels: [] });
      const all = await read({ includeDisabled: true });
      expect(all).toHaveLength(2);
      expect(all?.find((row) => row.id === root)?.allowedModels).toEqual([prefix]);
    },
  );
  it("applies private and whitelist visibility without inventing an IAM management bypass", async () => {
    await prisma.relayChannel.update({ where: { id: leaf }, data: { visibilityMode: "private" } });
    expect((await read())?.map((row) => row.id)).toEqual([root]);
    await prisma.relayChannel.update({
      where: { id: leaf },
      data: { visibilityMode: "whitelist", visibilityConfig: { userIds: [actor] } },
    });
    expect(await read()).toHaveLength(2);
    await prisma.relayChannel.update({ where: { id: leaf }, data: { visibilityMode: "private" } });
    await prisma.group.update({
      where: { id: groupId },
      data: { permissions: [Permission.RELAY_CHANNEL_READ, Permission.RELAY_CHANNEL_REVIEW] },
    });
    expect(await read()).toHaveLength(2);
    await prisma.user.update({ where: { id: actor }, data: { permissionRemoves: [Permission.RELAY_CHANNEL_REVIEW] } });
    expect((await read())?.map((row) => row.id)).toEqual([root]);
  });
  it("strict membership overrides a conflicting legacy edge exactly once", async () => {
    await prisma.relayChannel.update({ where: { id: leaf }, data: { pooledPriority: 8, pooledWeight: 3 } });
    await prisma.relayChannelMember.create({
      data: { relayChannelId: root, memberChannelId: leaf, priority: 1, weight: 9 },
    });
    expect((await read({ id: root }))?.[0]?.poolMembers).toEqual([
      expect.objectContaining({ memberChannelId: leaf, priority: 8, weight: 3 }),
    ]);
  });
  it("keeps provider configuration and safe usernames but not credential-bearing users", async () => {
    await prisma.relayChannelProvider.create({
      data: { relayChannelId: root, userId: actor, commissionPercent: 15, settlementMode: "manual" },
    });
    expect((await read({ id: root }))?.[0]?.providers).toEqual([
      expect.objectContaining({
        userId: actor,
        username: prefix + "actor",
        commissionPercent: 15,
        settlementMode: "manual",
      }),
    ]);
  });
  it("does not combine model and format capabilities across independent paths", async () => {
    const another = (
      await prisma.relayChannel.create({
        data: {
          name: prefix + "anthropic",
          channelType: "pooled-member",
          pooledParentId: root,
          allowedModels: JSON.stringify([prefix + "-other"]),
          allowedFormats: "anthropic",
        },
      })
    ).id;
    await prisma.modelPricing.create({
      data: { model: prefix + "-other", inputPrice: 0, outputPrice: 0, supportedFormats: "anthropic" },
    });
    const result = await repository.read(
      principal(),
      { id: root, includeDisabled: false },
      decide,
      recheck,
      async ({ context }) => RelayPoolResolverService.getInstance().resolveChannelCapabilities(root, context),
    );
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          leafChannelId: leaf,
          catalogModelName: prefix,
          supportedRequestFormats: ["openai-chat-completions"],
        }),
        expect.objectContaining({
          leafChannelId: another,
          catalogModelName: prefix + "-other",
          supportedRequestFormats: ["anthropic"],
        }),
      ]),
    );
    expect(result).toHaveLength(2);
  });
  it("fails closed when any observed decision changes before return", async () => {
    let calls = 0;
    decide.mockImplementation(async (resources) => resources.map(() => (++calls > 2 ? "ImplicitDeny" : "Allow")));
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on authority recheck failure", async () => {
    recheck
      .mockImplementationOnce(async () => {})
      .mockImplementation(async () => {
        throw new Error("authority-unavailable");
      });
    await expect(read()).rejects.toThrow("authority-unavailable");
  });
  it("rechecks membership edges even when the channel timestamp does not change", async () => {
    let graphReads = 0;
    interceptReads((rows, args) =>
      args.select?.poolMembers && ++graphReads > 1
        ? rows.map((row) => ({
            ...(row as object),
            poolMembers: [{ memberChannelId: "changed", priority: 0, weight: 1, enabled: true }],
          }))
        : rows,
    );
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks the returned configuration payload independently of metadata timestamps", async () => {
    let payloadReads = 0;
    interceptReads((rows, args) =>
      args.select?.providers && ++payloadReads > 1
        ? rows.map((row) => ({ ...(row as object), name: "changed" }))
        : rows,
    );
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects inactive or cross-account principals before channel reads", async () => {
    await prisma.user.update({ where: { id: actor }, data: { accountOwnerId: null } });
    const { reads } = interceptReads();
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(reads).toEqual([]);
  });
  it("batches decision and hydration queries at the registered authorization limit", async () => {
    await prisma.relayChannel.createMany({
      data: Array.from({ length: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 1 }, (_, i) => ({
        id: prefix + i,
        name: prefix + i,
      })),
    });
    const { reads } = interceptReads();
    expect(await read()).toHaveLength(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest + 3);
    expect(
      decide.mock.calls.every(([resources]) => resources.length <= IAM_AUTHORIZATION_LIMITS.resourcesPerRequest),
    ).toBe(true);
    for (const args of reads) {
      const ids = (args.where?.id as { in?: string[] } | undefined)?.in;
      if (ids) expect(ids.length).toBeLessThanOrEqual(IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
    }
  });
});
