import { BadRequestError, ForbiddenError } from "@/util/errors";
import { renderDescriptorSafely } from "@/locales";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayChannelModelRestrictionRepository } from "@/store/relay/relay-channel-model-restriction.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import BusinessLogService from "@/services/system/businesslog.service";
import type { BatchUpdateRelayChannelsRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
import { RelayChannelBatchUpdateRepository } from "@/store/relay/relay-channel-batch-update.repository";
import { RelayConfigService } from "@/services/relay/relay-config.service";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:relay:BatchUpdateChannels";
let owner: string,
  actor: string,
  submitter: string,
  peer: string,
  groupId: string,
  channel: string,
  other: string,
  prefix: string,
  createdConfig: string | undefined;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const body = (): BatchUpdateRelayChannelsRequest => ({ ids: [channel, other], patch: { multiplier: 1.25 } });
const apply = (input = body(), req = request()) =>
  RelayChannelService.getInstance().batchUpdateChannels(input, actor, req);
const source = () => prisma.relayChannel.findUniqueOrThrow({ where: { id: channel } });
const channels = () =>
  prisma.relayChannel.findMany({ where: { id: { in: [channel, other] } }, orderBy: { id: "asc" } });
const providers = () =>
  prisma.relayChannelProvider.findMany({ where: { relayChannelId: channel }, orderBy: { userId: "asc" } });
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
  return { req, role, session };
}
function transactionHook(hook: (tx: Prisma.TransactionClient) => void) {
  const original = prisma.$transaction.bind(prisma);
  vi.spyOn(prisma, "$transaction").mockImplementation(((
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: object,
  ) =>
    original(async (tx) => {
      hook(tx);
      return callback(tx);
    }, options)) as typeof prisma.$transaction);
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "batch-update-" + randomUUID();
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
  submitter = await user();
  peer = await user();
  groupId = (
    await prisma.group.create({
      data: { username: prefix, name: prefix, accountOwnerId: null, permissions: [Permission.RELAY_CHANNEL_UPDATE] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  channel = (
    await prisma.relayChannel.create({
      data: {
        name: prefix,
        status: RELAY_CHANNEL_STATUS.DISABLED,
        submissionStatus: "approved",
        submittedByUserId: submitter,
        providerServiceEnabled: false,
        visibilityMode: "hidden",
        openaiUpstreamUrl: "https://fixture.invalid",
        openaiUpstreamApiKey: "fixture-secret-review",
        allowedFormats: "openai-chat-completions",
        allowedModels: JSON.stringify([prefix + "model"]),
      },
    })
  ).id;
  other = (
    await prisma.relayChannel.create({
      data: {
        name: prefix + "other",
        visibilityMode: "hidden",
        openaiUpstreamApiKey: "fixture-secret-other",
        openaiUpstreamUrl: "https://fixture.invalid/other",
        allowedFormats: "openai-chat-completions",
        allowedModels: JSON.stringify([prefix + "model"]),
      },
    })
  ).id;
  await prisma.relayChannelProvider.create({
    data: {
      relayChannelId: channel,
      userId: peer,
      commissionPercent: 15,
      settlementMode: "interval",
      settlementIntervalDays: 7,
      nextSettlementAt: new Date("2030-01-01T00:00:00Z"),
    },
  });
  await prisma.modelPricing.create({
    data: {
      model: prefix + "model",
      provider: "openai",
      supportedFormats: "openai-chat-completions",
      inputPrice: 1,
      outputPrice: 2,
    },
  });
  await prisma.modelPricing.create({
    data: {
      model: prefix + "new",
      provider: "new-identity",
      supportedFormats: "openai-chat-completions",
      inputPrice: 1,
      outputPrice: 2,
    },
  });
  createdConfig = undefined;
  if (!(await prisma.relayConfig.count({ where: { status: 1 } })))
    createdConfig = (await prisma.relayConfig.create({ data: {} })).id;
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined as never);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.relayToken.deleteMany({ where: { userId: actor } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: [channel, other] } } });
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, submitter, peer] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
  if (createdConfig) await prisma.relayConfig.delete({ where: { id: createdConfig } });
});

async function unchanged(operation: () => Promise<unknown>, statusCode = 403) {
  const before = await channels(),
    beforeProviders = await providers();
  await expect(operation()).rejects.toMatchObject({ statusCode });
  expect(await channels()).toEqual(before);
  expect(await providers()).toEqual(beforeProviders);
}
describe("native resource-scoped general channel batch updates", () => {
  it("updates in caller order without hydrating or rewriting credentials, providers, ownership or global settings", async () => {
    const broad = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig"),
      rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
      before = await providers();
    const result = await apply();
    expect(result.rejected).toEqual([]);
    expect(result.updated.map((row) => row.id)).toEqual([channel, other]);
    expect((await channels()).every((row) => row.multiplier.toNumber() === 1.25)).toBe(true);
    expect(await providers()).toEqual(before);
    expect(await source()).toMatchObject({
      status: 2,
      providerServiceEnabled: false,
      visibilityMode: "hidden",
      openaiUpstreamApiKey: "fixture-secret-review",
    });
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|openaiUpstreamApiKey/);
    expect(broad).not.toHaveBeenCalled();
    expect(rich).not.toHaveBeenCalled();
  });
  it("clears nullable scalar and JSON fields without clobbering unrelated configuration", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { modelMapping: { a: "b" }, timePeriodMultipliers: [], contextLengthMultipliers: [] },
    });
    const result = await apply({
      ids: [channel],
      patch: { allowedModels: null, modelMapping: null, timePeriodMultipliers: null, contextLengthMultipliers: null },
    });
    expect(result.rejected).toEqual([]);
    expect(await source()).toMatchObject({
      allowedModels: null,
      modelMapping: null,
      timePeriodMultipliers: null,
      contextLengthMultipliers: null,
      openaiUpstreamApiKey: "fixture-secret-review",
    });
  });
  it("checks direct assignments inside the write transaction and preserves hidden-target restrictions", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { visibilityMode: "whitelist", visibilityConfig: { userIds: [actor] } },
    });
    await prisma.relayChannel.update({ where: { id: other }, data: { visibilityMode: "public" } });
    await prisma.relayToken.create({ data: { userId: actor, channelId: channel, token: "fixture-" + randomUUID() } });
    const references = vi.spyOn(RelayChannelRepository.getInstance(), "countDirectBusinessReferences");
    const result = await apply({ ids: [channel, other], patch: { visibilityMode: "hidden" } });
    expect(result.updated.map((row) => row.id)).toEqual([other]);
    expect(result.rejected).toEqual([{ id: channel, reason: expect.stringContaining("Cannot hide") }]);
    expect(references.mock.calls.every(([, tx]) => tx !== undefined)).toBe(true);
    expect(await source()).toMatchObject({ visibilityMode: "whitelist", visibilityConfig: { userIds: [actor] } });
    expect(await prisma.relayChannel.findUnique({ where: { id: other } })).toMatchObject({
      visibilityMode: "hidden",
      visibilityConfig: null,
    });
  });
  it("supports manual routing and pricing fields without replacing unrelated routing data", async () => {
    const result = await apply({
      ids: [channel],
      patch: {
        routingStrategy: "weighted-random",
        allowedModels: null,
        modelMapping: { retained: "value" },
        contextLengthMultipliers: [
          { name: "large", enabled: true, minTokens: 1000, multiplier: 2 },
          { name: "base", enabled: true, minTokens: 0, multiplier: 1 },
        ],
      },
    });
    expect(result.rejected).toEqual([]);
    expect(await source()).toMatchObject({
      allowedModels: null,
      modelMapping: { retained: "value" },
      contextLengthMultipliers: [
        { name: "base", enabled: true, minTokens: 0, multiplier: 1 },
        { name: "large", enabled: true, minTokens: 1000, multiplier: 2 },
      ],
    });
  });
  it("supports model pricing migration using local canonical upstream identities", async () => {
    await prisma.modelPricing.updateMany({ where: { model: prefix + "new" }, data: { provider: "openai" } });
    await prisma.relayChannel.update({ where: { id: channel }, data: { modelMapping: { retained: "historical" } } });
    const result = await apply({
      ids: [channel, other],
      patch: {},
      modelPricingMigration: { sourceModelId: "openai", targetPricingModel: prefix + "new" },
    });
    expect(result.rejected).toEqual([]);
    expect((await source()).modelMapping).toEqual({ retained: "historical", openai: prefix + "new" });
  });
  it("returns safe business rejections for incompatible migration without leaking supplied model names", async () => {
    const before = await channels();
    const result = await apply({
      ids: [channel, other],
      patch: { multiplier: 9 },
      modelPricingMigration: { sourceModelId: "sensitive-input", targetPricingModel: "sensitive-target" },
    });
    expect(result.updated).toEqual([]);
    expect(result.rejected).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/sensitive-input|sensitive-target/);
    expect(await channels()).toEqual(before);
  });
  it("retains safe per-channel validation without turning infrastructure errors into partial success", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { allowedModels: "invalid" } });
    const result = await apply();
    expect(result.updated.map((row) => row.id)).toEqual([other]);
    expect(result.rejected).toEqual([{ id: channel, reason: "allowedModels must be a valid JSON array" }]);
    expect((await source()).multiplier.toNumber()).toBe(1);
  });
  it("rolls back earlier updates on an infrastructure error without echoing it", async () => {
    transactionHook((tx) => {
      const original = tx.relayChannel.updateMany.bind(tx.relayChannel);
      let count = 0;
      vi.spyOn(tx.relayChannel, "updateMany").mockImplementation((async (args: Prisma.RelayChannelUpdateManyArgs) => {
        if (++count === 2) throw new Error("sensitive-database-password");
        return original(args);
      }) as unknown as typeof tx.relayChannel.updateMany);
    });
    await unchanged(() => apply(), 500);
  });
  it("revalidates after awaited audit and rolls back the complete batch", async () => {
    vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockImplementation(async () => {
      env.security.iamAuthorizationMode = "legacy";
      return undefined as never;
    });
    await unchanged(() => apply());
  });
  it("rejects stale targets before persistence", async () => {
    const repo = RelayChannelBatchUpdateRepository.getInstance(),
      original = repo.apply.bind(repo);
    vi.spyOn(repo, "apply").mockImplementation(async (...args) => {
      await prisma.relayChannel.update({ where: { id: other }, data: { allowedModels: null } });
      return original(...args);
    });
    await expect(apply()).rejects.toMatchObject({ statusCode: 403 });
    expect((await source()).multiplier.toNumber()).toBe(1);
  });
  it.each(["first", "last", "business-rejected"])(
    "Deny on %s cancels the entire batch before metadata hydration",
    async (kind) => {
      await grant(platformRelayChannelArn(kind === "first" ? channel : other));
      const rich = vi.spyOn(RelayChannelModelRestrictionRepository.getInstance(), "candidates"),
        input = body();
      if (kind === "business-rejected") input.patch.allowedModels = "invalid";
      await unchanged(() => apply(input));
      expect(rich).not.toHaveBeenCalled();
    },
  );
  it("JSON-only role grants must cover every target", async () => {
    const { req, role } = await roleRequest();
    await grant(platformRelayChannelArn(channel), "Allow", "role", role.id);
    await unchanged(() => apply(undefined, req));
    await grant(platformRelayChannelArn(other), "Allow", "role", role.id);
    expect((await apply(undefined, req)).updated).toHaveLength(2);
  });
  it("enforces trusted conditions and ignores forged X-Action headers", async () => {
    const { req, role } = await roleRequest();
    await grant(resources(), "Allow", "role", role.id, { IpAddress: { "acs:SourceIp": "192.0.2.0/24" } });
    await unchanged(() => apply(undefined, req));
    Object.defineProperty(req, "ip", { value: "192.0.2.1" });
    expect((await apply(undefined, req)).updated).toHaveLength(2);
  });
  it.each(["owned-group", "adds-only"])("%s cannot manufacture deployment update eligibility", async (kind) => {
    await grant("*", "Allow");
    if (kind === "owned-group") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    else {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RELAY_CHANNEL_UPDATE] } });
    }
    await unchanged(() => apply());
  });
  it.each(["missing", "owner", "subject", "oauth"])("refuses %s identity context", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.authContext;
    else if (kind === "owner") req.authContext!.accountOwnerId = peer;
    else if (kind === "subject") req.authContext!.principalUserId = peer;
    else req.oauthAccessToken = {} as TypedRequest["oauthAccessToken"];
    await unchanged(() => apply(undefined, req));
  });
  it("refuses missing native request context", async () => {
    await unchanged(() => RelayChannelService.getInstance().batchUpdateChannels(body(), actor));
  });
  it.each(["missing", "deleted", "alias"])("refuses %s channel target before any partial write", async (kind) => {
    const input = body();
    if (kind === "deleted") await prisma.relayChannel.update({ where: { id: other }, data: { status: 0 } });
    else input.ids[1] = kind === "missing" ? "missing" : other.toUpperCase();
    await unchanged(() => apply(input));
  });
  it.each(["duplicate", "empty", "wildcard", "unknown-field"])("refuses invalid %s batch", async (kind) => {
    const input = body();
    if (kind === "duplicate") input.ids[1] = channel;
    else if (kind === "empty") input.ids = [];
    else if (kind === "wildcard") input.ids[0] = "*";
    else Object.assign(input, { accountId: owner });
    await unchanged(() => apply(input), 400);
  });
  it.each([
    "mode",
    "identity",
    "condition",
    "key",
    "session",
    "catalog",
    "response",
    "group",
    "topology",
    "credential",
  ])("rolls back all targets after late %s change", async (kind) => {
    const req = request();
    let sessionId: string | undefined;
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
      req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      req.authContext!.subjectType = "access_key";
    }
    if (kind === "session") {
      const assumed = await roleRequest();
      Object.assign(req.authContext!, assumed.req.authContext);
      sessionId = assumed.session.id;
      await grant(resources(), "Allow", "role", assumed.role.id);
    }
    if (kind === "condition")
      await grant(resources(), "Deny", "user", actor, { IpAddress: { "acs:SourceIp": "192.0.2.0/24" } });
    transactionHook((tx) => {
      const original = tx.relayChannel.updateMany.bind(tx.relayChannel);
      let changed = false;
      vi.spyOn(tx.relayChannel, "updateMany").mockImplementation((async (args: Prisma.RelayChannelUpdateManyArgs) => {
        const result = await original(args);
        if (changed) return result;
        changed = true;
        if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
        else if (kind === "identity") req.authContext!.accountOwnerId = peer;
        else if (kind === "condition") Object.defineProperty(req, "ip", { value: "192.0.2.1", configurable: true });
        else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "session") await tx.ramRoleSession.update({ where: { id: sessionId! }, data: { status: 0 } });
        else if (kind === "catalog")
          await tx.modelPricing.updateMany({ where: { model: prefix + "new" }, data: { status: 0 } });
        else if (kind === "topology")
          await tx.relayConfig.updateMany({ where: { status: 1 }, data: { channelTopologyMode: "changed-invalid" } });
        else if (kind === "credential")
          await tx.relayChannel.update({ where: { id: other }, data: { openaiUpstreamApiKey: null } });
        else if (kind === "group") await tx.group.update({ where: { id: groupId }, data: { permissions: [] } });
        else await tx.relayChannel.update({ where: { id: channel }, data: { multiplier: 4 } });
        return result;
      }) as unknown as typeof tx.relayChannel.updateMany);
    });
    await unchanged(() => apply(undefined, req));
  });
  it("a final denial on one target rolls back previously projected successful peers", async () => {
    let written = false;
    transactionHook((tx) => {
      const original = tx.relayChannel.updateMany.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "updateMany").mockImplementation((async (args: Prisma.RelayChannelUpdateManyArgs) => {
        const result = await original(args);
        written = true;
        return result;
      }) as unknown as typeof tx.relayChannel.updateMany);
    });
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await original(input);
      return written
        ? result.map((row, index) =>
            input.resources[index] === platformRelayChannelArn(other)
              ? { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] }
              : row,
          )
        : result;
    });
    await unchanged(() => apply());
    expect(written).toBe(true);
  });
  describe.each(["legacy", "shadow"] as const)("%s batch response safety", (variant) => {
    it.each(["configuration", "restrictions"] as const)(
      "redacts unexpected %s mutation failures",
      async (operation) => {
        env.security.iamAuthorizationMode = variant;
        const before = await channels(),
          rows = await providers(),
          req = request();
        req.locale = "zh-CN";
        const update = vi
          .spyOn(RelayChannelRepository.getInstance(), "updateById")
          .mockRejectedValueOnce(new Error("fixture-secret SQL UPDATE openaiUpstreamApiKey=password"));
        const result =
          operation === "configuration"
            ? await apply({ ids: [channel], patch: { multiplier: 1.5 } }, req)
            : await RelayChannelService.getInstance().applyModelRestrictions(
                { targets: [{ channelId: channel, addModels: [prefix + "model"] }] },
                actor,
                req,
              );
        expect(update).toHaveBeenCalledOnce();
        expect(result.updated).toEqual([]);
        expect(result.rejected).toEqual([
          { id: channel, reason: renderDescriptorSafely({ key: "errors.internalServerError" }, "zh-CN").message },
        ]);
        expect(JSON.stringify(result)).not.toContain("fixture-secret");
        expect(JSON.stringify(vi.mocked(BusinessLogService.getInstance().logOperation).mock.calls)).not.toContain(
          "fixture-secret",
        );
        expect(await channels()).toEqual(before);
        expect(await providers()).toEqual(rows);
      },
    );
    it.each(["configuration", "restrictions"] as const)(
      "renders safe descriptors for known %s business errors",
      async (operation) => {
        env.security.iamAuthorizationMode = variant;
        const req = request();
        req.locale = "en";
        vi.spyOn(RelayChannelRepository.getInstance(), "updateById").mockRejectedValueOnce(
          new BadRequestError("fixture-secret raw diagnostic", undefined, { messageKey: "relayChannel.nameExists" }),
        );
        const result =
          operation === "configuration"
            ? await apply({ ids: [channel], patch: { multiplier: 1.5 } }, req)
            : await RelayChannelService.getInstance().applyModelRestrictions(
                { targets: [{ channelId: channel, addModels: [prefix + "model"] }] },
                actor,
                req,
              );
        expect(result.rejected).toEqual([
          { id: channel, reason: renderDescriptorSafely({ key: "relayChannel.nameExists" }, "en").message },
        ]);
        expect(JSON.stringify(result)).not.toContain("fixture-secret");
      },
    );
    it.each(["configuration", "restrictions"] as const)(
      "does not downgrade %s authorization failure into a partial response",
      async (operation) => {
        env.security.iamAuthorizationMode = variant;
        const before = await channels(),
          rows = await providers();
        vi.spyOn(RelayChannelRepository.getInstance(), "updateById").mockRejectedValueOnce(
          new ForbiddenError("fixture-secret denied"),
        );
        const result =
          operation === "configuration"
            ? apply({ ids: [channel], patch: { multiplier: 1.5 } })
            : RelayChannelService.getInstance().applyModelRestrictions(
                { targets: [{ channelId: channel, addModels: [prefix + "model"] }] },
                actor,
                request(),
              );
        await expect(result).rejects.toMatchObject({ statusCode: 403 });
        expect(await channels()).toEqual(before);
        expect(await providers()).toEqual(rows);
      },
    );
  });
  it.each(["legacy", "shadow"] as const)("%s writes only through original implementation", async (variant) => {
    env.security.iamAuthorizationMode = variant;
    const update = vi.spyOn(RelayChannelRepository.getInstance(), "updateById");
    expect((await apply()).updated).toHaveLength(2);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
