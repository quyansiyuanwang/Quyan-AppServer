import { assertSafeOutboundUrl } from "@/util/developer-outbound-url";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/util/developer-outbound-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/util/developer-outbound-url")>()),
  assertSafeOutboundUrl: vi.fn(async (url: string) => ({
    url: new URL(url),
    httpAgent: { destroy: vi.fn() },
    httpsAgent: { destroy: vi.fn() },
  })),
}));
import { Permission, RELAY_CHANNEL_STATUS, type IamCondition, type RelayUpstreamFormat } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayChannelUpstreamModelRepository } from "@/store/relay/relay-channel-upstream-model.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { ConfigService } from "@/services/system/config.service";
import { RelayConfigService } from "@/services/relay/relay-config.service";
import { ModelPricingService } from "@/services/relay/model-pricing.service";
import type { TypedRequest } from "@/types/express";
const initialMode = env.security.iamAuthorizationMode,
  action = "quyan:relay:BatchListUpstreamModels";
let owner: string, actor: string, peer: string, groupId: string, channel: string, other: string, prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const invoke = (ids = [channel, other], req = request(), format: RelayUpstreamFormat = "openai") =>
  RelayChannelService.getInstance().batchListUpstreamModels({ ids, format }, actor, req);
const resources = () => [platformRelayChannelArn(channel), platformRelayChannelArn(other)];
async function grant(
  Resource: string | string[],
  Effect: "Allow" | "Deny" = "Deny",
  principalType = "user",
  principalId = actor,
  Condition?: IamCondition,
) {
  const parsed = parseIamPolicy({
      Version: "1",
      Statement: { Effect, Action: action, Resource, ...(Condition ? { Condition } : {}) },
    }),
    policy = await RamPolicyRepository.getInstance().createPolicy({
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
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
async function roleRequest() {
  const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } }),
    session = await prisma.ramRoleSession.create({
      data: {
        accountOwnerId: owner,
        roleId: role.id,
        subjectUserId: actor,
        sessionName: "fixture",
        expiresAt: new Date(Date.now() + 60000),
      },
    }),
    req = request();
  req.authContext!.assumedRoleId = role.id;
  req.authContext!.roleSessionId = session.id;
  await grant(resources(), "Allow", "role", role.id);
  return { req, role, session };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "upstream-model-" + randomUUID();
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
  peer = await user();
  groupId = (
    await prisma.group.create({
      data: { username: prefix, name: prefix, accountOwnerId: null, permissions: [Permission.RELAY_CHANNEL_UPDATE] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  const create = async (suffix: string) =>
    (
      await prisma.relayChannel.create({
        data: {
          name: prefix + suffix,
          status: RELAY_CHANNEL_STATUS.DISABLED,
          visibilityMode: "hidden",
          submittedByUserId: peer,
          openaiUpstreamUrl: "https://fixture.invalid/openai",
          openaiUpstreamApiKey: "fixture-only-openai",
          anthropicUpstreamUrl: "https://fixture.invalid/anthropic",
          anthropicUpstreamApiKey: "fixture-only-anthropic",
          geminiUpstreamUrl: "https://fixture.invalid/gemini",
          geminiUpstreamApiKey: "fixture-only-gemini",
        },
      })
    ).id;
  channel = await create("");
  other = await create("other");
  await prisma.modelPricing.create({
    data: {
      model: prefix,
      provider: prefix + "request",
      supportedFormats: "openai-chat-completions",
      inputPrice: 1,
      outputPrice: 2,
    },
  });
  vi.spyOn(ConfigService.getInstance(), "getRelayProxyConfig").mockResolvedValue({ enabled: false, url: "" });
  vi.spyOn(axios, "get").mockResolvedValue({
    data: { data: [{ id: prefix + "request" }, { id: "unmatched", apiKey: "fixture-only-response" }] },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = initialMode;
  await prisma.relayChannel.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, peer] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("native batch upstream model discovery", () => {
  it.each(["openai", "anthropic", "gemini"] as const)(
    "admits all %s targets without broad configuration hydration and preserves caller order",
    async (format) => {
      const rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
        broad = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig"),
        pricing = vi.spyOn(ModelPricingService.getInstance(), "getModelPricing");
      const before = await prisma.relayChannel.findMany({
        where: { id: { in: [channel, other] } },
        orderBy: { id: "asc" },
      });
      const result = await invoke([other, channel], request(), format);
      expect(result.items.map((row) => row.channelId)).toEqual([other, channel]);
      expect(result.items.every((row) => row.status === "success")).toBe(true);
      expect(result.items[0]!.models).toContainEqual({
        id: prefix + "request",
        matched: true,
        pricingModel: prefix,
        pricingModelId: prefix + "request",
      });
      expect(JSON.stringify(result)).not.toMatch(/fixture-only|UpstreamApiKey|fixture.invalid/);
      expect(rich).not.toHaveBeenCalled();
      expect(broad).not.toHaveBeenCalled();
      expect(pricing).not.toHaveBeenCalled();
      expect(axios.get).toHaveBeenCalledTimes(2);
      const [url, options] = vi.mocked(axios.get).mock.calls[0]!;
      expect(url).toBe(`https://fixture.invalid/${format}/v1/models`);
      expect(options).toMatchObject({ proxy: false, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024 });
      const headers = options!.headers as Record<string, unknown>;
      expect(
        headers[format === "openai" ? "Authorization" : format === "anthropic" ? "x-api-key" : "x-goog-api-key"],
      ).toBe(format === "openai" ? "Bearer fixture-only-openai" : `fixture-only-${format}`);
      expect(
        await prisma.relayChannel.findMany({ where: { id: { in: [channel, other] } }, orderBy: { id: "asc" } }),
      ).toEqual(before);
    },
  );
  it("denies the entire batch before capture, catalog lookup or any HTTP call", async () => {
    await grant(platformRelayChannelArn(other));
    const capture = vi.spyOn(RelayChannelUpstreamModelRepository.getInstance(), "capture");
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
    expect(capture).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });
  it.each(["missing", "deleted", "alias"])("rejects a %s target before any HTTP request", async (kind) => {
    if (kind === "deleted") await prisma.relayChannel.update({ where: { id: other }, data: { status: 0 } });
    await expect(
      invoke([channel, kind === "missing" ? "missing" : kind === "alias" ? other.toUpperCase() : other]),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.get).not.toHaveBeenCalled();
  });
  it.each(["empty", "duplicate", "wildcard", "format"])("rejects an invalid %s batch", async (kind) => {
    const input = {
      ids: kind === "empty" ? [] : kind === "duplicate" ? [channel, channel] : kind === "wildcard" ? ["*"] : [channel],
      format: kind === "format" ? "fake" : "openai",
    };
    await expect(
      RelayChannelService.getInstance().batchListUpstreamModels(input as never, actor, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(axios.get).not.toHaveBeenCalled();
  });
  it.each(["missing-context", "oauth", "cross-account", "ineligible", "account-group"])(
    "refuses %s identities before credential access",
    async (kind) => {
      const req = request();
      if (kind === "oauth") req.oauthAccessToken = {} as NonNullable<TypedRequest["oauthAccessToken"]>;
      if (kind === "cross-account") req.authContext!.accountOwnerId = peer;
      if (kind === "ineligible") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      if (kind === "account-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      const capture = vi.spyOn(RelayChannelUpstreamModelRepository.getInstance(), "capture");
      await expect(
        RelayChannelService.getInstance().batchListUpstreamModels(
          { ids: [channel], format: "openai" },
          actor,
          kind === "missing-context" ? undefined : req,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(capture).not.toHaveBeenCalled();
      expect(axios.get).not.toHaveBeenCalled();
    },
  );
  it("validates existence of the whole batch with metadata only before selecting any saved credential", async () => {
    const selected: Prisma.RelayChannelFindManyArgs[] = [],
      original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      original(async (tx) => {
        const find = tx.relayChannel.findMany.bind(tx.relayChannel);
        vi.spyOn(tx.relayChannel, "findMany").mockImplementation(((args: Prisma.RelayChannelFindManyArgs) => {
          selected.push(args);
          return find(args);
        }) as typeof tx.relayChannel.findMany);
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await expect(invoke([channel, "missing"])).rejects.toMatchObject({ statusCode: 403 });
    expect(selected.length).toBeGreaterThan(0);
    expect(
      selected.every((args) => !args.include && !Object.keys(args.select ?? {}).some((key) => /Upstream/.test(key))),
    ).toBe(true);
  });
  it("skips missing requested protocol config without falling back to another credential", async () => {
    await prisma.relayChannel.update({ where: { id: other }, data: { openaiUpstreamApiKey: null } });
    const result = await invoke();
    expect(result.items.map((row) => row.status)).toEqual(["success", "skipped"]);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
  it("returns safe item failures for upstream errors, never arbitrary error messages", async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error("fixture-only-private-error"));
    const result = await invoke();
    expect(result.items.map((row) => row.status)).toEqual(["failed", "failed"]);
    expect(JSON.stringify(result)).not.toContain("fixture-only");
  });
  it("uses JSON role grants without legacy group grants and revokes sessions during an in-flight request", async () => {
    const { req, session } = await roleRequest();
    expect((await invoke([channel], req)).items[0]!.status).toBe("success");
    vi.mocked(axios.get).mockImplementationOnce(async () => {
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { status: 0 } });
      return { data: { data: ["a"] } };
    });
    await expect(invoke([channel], req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["mode", "identity", "condition", "key", "session", "target", "catalog", "group", "policy"])(
    "withholds all results after late %s drift",
    async (kind) => {
      let req = request(),
        sessionId: string | undefined;
      if (kind === "session") {
        const assumed = await roleRequest();
        req = assumed.req;
        sessionId = assumed.session.id;
      }
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
        req.authContext!.subjectType = "access_key";
      }
      vi.mocked(axios.get).mockImplementationOnce(async () => {
        if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
        else if (kind === "identity") req.authContext!.accountOwnerId = peer;
        else if (kind === "condition") Object.defineProperty(req, "ip", { value: "192.0.2.1", configurable: true });
        else if (kind === "key")
          await prisma.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "session")
          await prisma.ramRoleSession.update({ where: { id: sessionId! }, data: { status: 0 } });
        else if (kind === "target")
          await prisma.relayChannel.update({
            where: { id: channel },
            data: { openaiUpstreamApiKey: "fixture-only-rotated" },
          });
        else if (kind === "catalog")
          await prisma.modelPricing.updateMany({ where: { model: prefix }, data: { status: 0 } });
        else if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        else await grant(platformRelayChannelArn(channel));
        return { data: { data: ["a"] } };
      });
      await expect(invoke([channel], req)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("stops queued sends when a before-send recheck denies and settles the workers without partial results", async () => {
    const extras: string[] = [];
    for (let i = 0; i < 4; i++)
      extras.push(
        (
          await prisma.relayChannel.create({
            data: {
              name: prefix + "queued" + i,
              openaiUpstreamUrl: "https://fixture.invalid",
              openaiUpstreamApiKey: "fixture-only",
            },
          })
        ).id,
      );
    const repository = RelayChannelUpstreamModelRepository.getInstance();
    vi.spyOn(repository, "verify").mockRejectedValue(new Error("fixture-only-private-denial"));
    const error = await invoke([channel, other, ...extras]).catch((error) => error);
    expect(error).toMatchObject({ statusCode: 403 });
    expect(String(error)).not.toContain("fixture-only");
    expect(vi.mocked(repository.verify).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(repository.verify).mock.calls.length).toBeLessThanOrEqual(4);
    expect(axios.get).not.toHaveBeenCalled();
  });
  it("detects a requested credential rotation even if its timestamp was not changed", async () => {
    vi.mocked(axios.get).mockImplementationOnce(async () => {
      await prisma.$executeRaw`UPDATE relay_channels SET openaiUpstreamApiKey=${"fixture-only-raw-rotation"} WHERE id=${channel}`;
      return { data: { data: ["a"] } };
    });
    await expect(invoke([channel])).rejects.toMatchObject({ statusCode: 403 });
  });
  it("accepts an active AccessKey but stops on its expiry", async () => {
    const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } }),
      req = request();
    req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    req.authContext!.subjectType = "access_key";
    expect((await invoke([channel], req)).items[0]!.status).toBe("success");
    vi.mocked(axios.get).mockImplementationOnce(async () => {
      await prisma.accessKey.update({ where: { id: key.id }, data: { expiresAt: new Date(0) } });
      return { data: { data: ["a"] } };
    });
    await expect(invoke([channel], req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not hide a revoked Allow behind per-channel failed/skipped statuses", async () => {
    const { req, role } = await roleRequest();
    vi.mocked(axios.get).mockImplementationOnce(async () => {
      await prisma.ramAuthorization.updateMany({ where: { principalId: role.id }, data: { status: 0 } });
      throw new Error("fixture-only-private-network-error");
    });
    await expect(invoke([channel], req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("still honors a conditional explicit Deny even for otherwise eligible platform administrators", async () => {
    await grant(platformRelayChannelArn(channel), "Deny", "user", actor, {
      IpAddress: { "acs:SourceIp": "127.0.0.0/8" },
    });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.get).not.toHaveBeenCalled();
  });
  it("does not echo upstream error bodies and accepts only HTTP status numbers", async () => {
    await prisma.relayChannel.update({
      where: { id: other },
      data: { openaiUpstreamUrl: "https://fixture.invalid/other" },
    });
    vi.mocked(axios.get).mockImplementation(async (url) => {
      throw {
        isAxiosError: true,
        response: {
          status: String(url).includes("/other/") ? "fixture-only-invalid-status" : 429,
          data: "fixture-only-private-response",
        },
      };
    });
    const result = await invoke();
    expect(result.items.map((row) => row.upstreamStatus)).toEqual([429, undefined]);
    expect(JSON.stringify(result)).not.toContain("fixture-only");
  });
  it("rechecks immediately after preparation before using the saved key on the wire", async () => {
    vi.mocked(ConfigService.getInstance().getRelayProxyConfig).mockImplementationOnce(async () => {
      await prisma.relayChannel.update({
        where: { id: channel },
        data: { openaiUpstreamApiKey: "fixture-only-rotated" },
      });
      return { enabled: false, url: "" };
    });
    await expect(invoke([channel])).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.get).not.toHaveBeenCalled();
    const safe = await vi.mocked(assertSafeOutboundUrl).mock.results.at(-1)!.value;
    expect(safe.httpAgent.destroy).toHaveBeenCalledTimes(1);
    expect(safe.httpsAgent.destroy).toHaveBeenCalledTimes(1);
  });
  it("checks final authority even when every target is skipped", async () => {
    await prisma.relayChannel.updateMany({
      where: { id: { in: [channel, other] } },
      data: { openaiUpstreamApiKey: null },
    });
    const repository = RelayChannelUpstreamModelRepository.getInstance(),
      capture = repository.capture.bind(repository);
    vi.spyOn(repository, "capture").mockImplementation(async (...args) => {
      const result = await capture(...args);
      await grant(platformRelayChannelArn(other));
      return result;
    });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.get).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "%s probes once through the original implementation, without native key capture",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const capture = vi.spyOn(RelayChannelUpstreamModelRepository.getInstance(), "capture");
      expect((await invoke()).items).toHaveLength(2);
      expect(capture).not.toHaveBeenCalled();
      expect(axios.get).toHaveBeenCalledTimes(2);
    },
  );
});
