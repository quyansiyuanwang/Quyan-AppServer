import { relayChannelSubmissionArn } from "@/iam/resources/relay-channel-submission-resources";
import { relayUpstreamModelResourceResolver } from "@/iam/request/relay-upstream-model-resource-resolver";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { assertSafeOutboundUrl } from "@/util/developer-outbound-url";
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
  action = "quyan:relay:ListUpstreamModels";
let owner: string, actor: string, peer: string, groupId: string, channel: string, other: string, prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const invoke = (id = channel, req = request(), format: RelayUpstreamFormat = "openai") =>
  RelayChannelService.getInstance().listUpstreamModels({ channelId: id, format }, actor, req);
const preview = (req = request(), format: RelayUpstreamFormat = "openai") =>
  RelayChannelService.getInstance().listUpstreamModels(
    { format, upstreamUrl: "https://fixture.invalid/preview", apiKey: "fixture-only-preview" },
    actor,
    req,
  );
const ownArn = () => relayChannelSubmissionArn(owner, actor, channel);
const accountArn = () => `acs:quyan:*:${owner}:account`;
async function own() {
  await prisma.user.update({
    where: { id: actor },
    data: { groupId: null, permissionAdds: [Permission.RELAY_CHANNEL_SUBMIT] },
  });
  await prisma.relayChannel.update({
    where: { id: channel },
    data: { submittedByUserId: actor, channelType: "standalone" },
  });
}
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
  prefix = "single-upstream-" + randomUUID();
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
describe("single upstream model resource authorization", () => {
  it.each(["openai", "anthropic", "gemini"] as const)(
    "queries the saved %s protocol without hydrating full configuration",
    async (format) => {
      const rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
        broad = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig"),
        pricing = vi.spyOn(ModelPricingService.getInstance(), "getModelPricing");
      const result = await invoke(channel, request(), format);
      expect(result.models).toContainEqual({
        id: prefix + "request",
        matched: true,
        pricingModel: prefix,
        pricingModelId: prefix + "request",
      });
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(vi.mocked(axios.get).mock.calls[0]![0]).toBe(`https://fixture.invalid/${format}/v1/models`);
      expect(rich).not.toHaveBeenCalled();
      expect(broad).not.toHaveBeenCalled();
      expect(pricing).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(/fixture-only|fixture.invalid|UpstreamApiKey/);
    },
  );
  it("gives an original submitter access to their own standalone submission without platform eligibility", async () => {
    await own();
    expect((await invoke()).models).toHaveLength(2);
    await expect(invoke(other)).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
  it("uses the owned ARN even for a platform administrator and never falls back after explicit Deny", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { submittedByUserId: actor } });
    await grant(ownArn());
    await grant(platformRelayChannelArn(channel), "Allow");
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.get).not.toHaveBeenCalled();
  });
  it("requires platform eligibility as well as an Allow for somebody else's channel", async () => {
    await own();
    await grant(platformRelayChannelArn(other), "Allow");
    await expect(invoke(other)).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.get).not.toHaveBeenCalled();
  });
  it("does not reinterpret a submitted pool as an owned standalone resource", async () => {
    await own();
    await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "pooled" } });
    await grant(ownArn(), "Allow");
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.get).not.toHaveBeenCalled();
  });
  it("permits a deployment REVIEW group without requiring UPDATE", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.RELAY_CHANNEL_REVIEW] } });
    expect((await invoke()).models).toHaveLength(2);
  });
  it("honors a platform-resource Deny before any saved credentials are captured", async () => {
    await grant(platformRelayChannelArn(channel));
    const capture = vi.spyOn(RelayChannelUpstreamModelRepository.getInstance(), "capture");
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
    expect(capture).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });
  it("always ignores supplied credential overrides when a saved channel ID is present", async () => {
    await RelayChannelService.getInstance().listUpstreamModels(
      {
        channelId: channel,
        format: "openai",
        upstreamUrl: "https://attacker.invalid",
        apiKey: "fixture-only-override",
      },
      actor,
      request(),
    );
    expect(vi.mocked(axios.get).mock.calls[0]).toMatchObject([
      "https://fixture.invalid/openai/v1/models",
      { headers: { Authorization: "Bearer fixture-only-openai" } },
    ]);
  });
  it.each(["openai", "anthropic", "gemini"] as const)(
    "uses only supplied credentials for %s preview and never reads any saved channel",
    async (format) => {
      await own();
      const link = vi.spyOn(RelayChannelUpstreamModelRepository.getInstance(), "link"),
        rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById");
      expect((await preview(request(), format)).models).toHaveLength(2);
      expect(vi.mocked(axios.get).mock.calls[0]![0]).toBe("https://fixture.invalid/preview/v1/models");
      expect(link).not.toHaveBeenCalled();
      expect(rich).not.toHaveBeenCalled();
      await grant(accountArn());
      await expect(preview(request(), format)).rejects.toMatchObject({ statusCode: 403 });
      expect(axios.get).toHaveBeenCalledTimes(1);
    },
  );
  it("uses trusted account scope for preview despite forged body and Header hints", async () => {
    await own();
    await grant(accountArn());
    await expect(
      RelayChannelService.getInstance().listUpstreamModels(
        {
          format: "openai",
          upstreamUrl: "https://fixture.invalid",
          apiKey: "fixture-only",
          accountOwnerId: peer,
          action: "fake:*",
        } as never,
        actor,
        request(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.get).not.toHaveBeenCalled();
  });
  it("supports JSON-only owned submission grants without any legacy or platform group eligibility", async () => {
    await own();
    await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [] } });
    await grant(ownArn(), "Allow");
    expect((await invoke()).models).toHaveLength(2);
    await expect(preview()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("supports JSON-only preview grants with no stored-channel authority", async () => {
    await prisma.user.update({ where: { id: actor }, data: { groupId: null } });
    await grant(accountArn(), "Allow");
    expect((await preview()).models).toHaveLength(2);
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("supports role-scoped owned grants without inheriting ordinary user permissions", async () => {
    await own();
    const { req, role } = await roleRequest();
    await grant(ownArn(), "Allow", "role", role.id);
    expect((await invoke(channel, req)).models).toHaveLength(2);
    await expect(preview(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "deleted", "alias"])(
    "refuses a %s saved target rather than using supplied credentials",
    async (kind) => {
      if (kind === "deleted") await prisma.relayChannel.update({ where: { id: channel }, data: { status: 0 } });
      const id = kind === "missing" ? "missing" : kind === "alias" ? channel.toUpperCase() : channel;
      await expect(
        RelayChannelService.getInstance().listUpstreamModels(
          { channelId: id, format: "openai", upstreamUrl: "https://fixture.invalid", apiKey: "fixture-only" },
          actor,
          request(),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(axios.get).not.toHaveBeenCalled();
    },
  );
  it.each(["oauth", "no-context", "cross-account"])(
    "rejects %s requests before selecting credentials",
    async (kind) => {
      const req = request();
      if (kind === "oauth") req.oauthAccessToken = {} as NonNullable<TypedRequest["oauthAccessToken"]>;
      if (kind === "cross-account") req.authContext!.accountOwnerId = peer;
      const capture = vi.spyOn(RelayChannelUpstreamModelRepository.getInstance(), "capture");
      await expect(
        RelayChannelService.getInstance().listUpstreamModels(
          { channelId: channel, format: "openai" },
          actor,
          kind === "no-context" ? undefined : req,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(capture).not.toHaveBeenCalled();
      expect(axios.get).not.toHaveBeenCalled();
    },
  );
  it("rechecks the ownership link before accessing a saved key", async () => {
    await own();
    const repository = RelayChannelUpstreamModelRepository.getInstance(),
      capture = repository.capture.bind(repository);
    vi.spyOn(repository, "capture").mockImplementation(async (...args) => {
      await prisma.relayChannel.update({ where: { id: channel }, data: { submittedByUserId: peer } });
      return capture(...args);
    });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.get).not.toHaveBeenCalled();
  });
  it.each(["owner", "policy", "mode", "identity", "condition", "key", "catalog", "credential"])(
    "withholds all data after in-flight %s drift",
    async (kind) => {
      await own();
      const req = request();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
        req.authContext!.subjectType = "access_key";
      }
      vi.mocked(axios.get).mockImplementationOnce(async () => {
        if (kind === "owner")
          await prisma.relayChannel.update({ where: { id: channel }, data: { submittedByUserId: peer } });
        else if (kind === "policy") await grant(ownArn());
        else if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
        else if (kind === "identity") req.authContext!.accountOwnerId = peer;
        else if (kind === "condition") Object.defineProperty(req, "ip", { value: "192.0.2.1", configurable: true });
        else if (kind === "key")
          await prisma.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "catalog")
          await prisma.modelPricing.updateMany({ where: { model: prefix }, data: { status: 0 } });
        else
          await prisma.$executeRaw`UPDATE relay_channels SET openaiUpstreamApiKey=${"fixture-only-rotated"} WHERE id=${channel}`;
        return { data: { data: ["a"] } };
      });
      await expect(invoke(channel, req)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("does not let AssumeRole grants survive revocation during preview", async () => {
    const { req, role, session } = await roleRequest();
    await grant(accountArn(), "Allow", "role", role.id);
    vi.mocked(axios.get).mockImplementationOnce(async () => {
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { status: 0 } });
      return { data: { data: ["a"] } };
    });
    await expect(preview(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks preview authority again after preparation and releases prepared agents on denial", async () => {
    await own();
    vi.mocked(ConfigService.getInstance().getRelayProxyConfig).mockImplementationOnce(async () => {
      await grant(accountArn());
      return { enabled: false, url: "" };
    });
    await expect(preview()).rejects.toMatchObject({ statusCode: 403 });
    expect(axios.get).not.toHaveBeenCalled();
    const safe = await vi.mocked(assertSafeOutboundUrl).mock.results.at(-1)!.value;
    expect(safe.httpAgent.destroy).toHaveBeenCalledTimes(1);
    expect(safe.httpsAgent.destroy).toHaveBeenCalledTimes(1);
  });
  it("rechecks authority after an upstream failure instead of disguising a late Deny as HTTP 400", async () => {
    await own();
    vi.mocked(axios.get).mockImplementationOnce(async () => {
      await grant(ownArn());
      throw new Error("fixture-only-upstream-error");
    });
    const error = await invoke().catch((error) => error);
    expect(error).toMatchObject({ statusCode: 403 });
    expect(String(error)).not.toContain("fixture-only");
  });
  it("returns only a safe business error for upstream failures without revocation", async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error("fixture-only-upstream-error"));
    const error = await invoke().catch((error) => error);
    expect(error).toMatchObject({ statusCode: 400 });
    expect(String(error)).not.toContain("fixture-only");
  });
  it("does not borrow another format's key for incomplete saved configuration", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { openaiUpstreamApiKey: null } });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 400 });
    expect(axios.get).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("%s uses the original single operation exactly once", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const capture = vi.spyOn(RelayChannelUpstreamModelRepository.getInstance(), "capture");
    expect((await invoke()).models).toHaveLength(2);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
  });
  it("resolves each canonical route branch without loading full channel rows", async () => {
    const req = request();
    Object.assign(req, { body: { channelId: channel, format: "openai" } });
    expect(await relayUpstreamModelResourceResolver({ request: req, principal: getIamPrincipal(req)! })).toBe(
      platformRelayChannelArn(channel),
    );
    await own();
    expect(await relayUpstreamModelResourceResolver({ request: req, principal: getIamPrincipal(req)! })).toBe(ownArn());
    Object.assign(req, { body: { format: "openai", upstreamUrl: "https://fixture.invalid", apiKey: "fixture-only" } });
    expect(await relayUpstreamModelResourceResolver({ request: req, principal: getIamPrincipal(req)! })).toBe(
      accountArn(),
    );
  });
  it.each(["policy", "key", "catalog", "account-owner", "condition"])(
    "revalidates %s during preview even though no saved channel exists",
    async (kind) => {
      await own();
      const req = request();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
        req.authContext!.subjectType = "access_key";
      }
      vi.mocked(axios.get).mockImplementationOnce(async () => {
        if (kind === "policy") await grant(accountArn());
        else if (kind === "key")
          await prisma.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "catalog")
          await prisma.modelPricing.updateMany({ where: { model: prefix }, data: { status: 0 } });
        else if (kind === "account-owner") await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
        else Object.defineProperty(req, "ip", { value: "192.0.2.1", configurable: true });
        return { data: { data: ["a"] } };
      });
      await expect(preview(req)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
});
