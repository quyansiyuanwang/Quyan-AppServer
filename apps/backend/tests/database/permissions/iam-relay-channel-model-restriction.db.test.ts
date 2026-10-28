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
import type { ApplyRelayChannelModelRestrictionsRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
import { RelayConfigService } from "@/services/relay/relay-config.service";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:relay:ApplyChannelModelRestrictions";
let owner: string,
  actor: string,
  submitter: string,
  peer: string,
  groupId: string,
  channel: string,
  other: string,
  prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const body = (): ApplyRelayChannelModelRestrictionsRequest => ({
  targets: [
    { channelId: channel, addModels: [prefix + "new"] },
    { channelId: other, addModels: [prefix + "new"] },
  ],
});
const apply = (input = body(), req = request()) =>
  RelayChannelService.getInstance().applyModelRestrictions(input, actor, req);
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
  prefix = "model-restriction-" + randomUUID();
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
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined as never);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.relayChannel.deleteMany({ where: { id: { in: [channel, other] } } });
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, submitter, peer] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});

async function unchanged(operation: () => Promise<unknown>, statusCode = 403) {
  const before = await channels(),
    beforeProviders = await providers();
  await expect(operation()).rejects.toMatchObject({ statusCode });
  expect(await channels()).toEqual(before);
  expect(await providers()).toEqual(beforeProviders);
}
describe("native resource-scoped batch channel model restrictions", () => {
  it("merges every admitted target in caller order and exposes no stored keys", async () => {
    const broad = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig"),
      rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
      before = await providers();
    const result = await apply();
    expect(result.rejected).toEqual([]);
    expect(result.updated.map((row) => row.id)).toEqual([channel, other]);
    expect(
      (await channels()).every((row) => row.allowedModels === JSON.stringify([prefix + "model", prefix + "new"])),
    ).toBe(true);
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
  it.each(["standalone", "pooled-member", "pooled", "automatic-proxy-pool"])(
    "restricts %s without rewriting unrelated routing settings",
    async (channelType) => {
      const routingConfig = { allowedModelsMode: "auto", customSetting: "retained" };
      await prisma.relayChannel.update({ where: { id: channel }, data: { channelType, routingConfig } });
      const result = await apply({ targets: [{ channelId: channel, addModels: [prefix + "new"] }] });
      expect(result.updated).toHaveLength(1);
      expect((await source()).routingConfig).toEqual({
        ...routingConfig,
        ...(["pooled", "automatic-proxy-pool"].includes(channelType) ? { allowedModelsMode: "manual" } : {}),
      });
      expect(JSON.parse((await source()).allowedModels!)).toEqual([
        ...(channelType === "pooled" || channelType === "automatic-proxy-pool" ? [] : [prefix + "model"]),
        prefix + "new",
      ]);
    },
  );
  it("retains safe per-target business rejections, not raw user input", async () => {
    const result = await apply({
      targets: [
        { channelId: channel, addModels: ["fixture-secret-unregistered"] },
        { channelId: other, addModels: [prefix + "new"] },
      ],
    });
    expect(result.updated.map((row) => row.id)).toEqual([other]);
    expect(result.rejected).toEqual([{ id: channel, reason: "Unknown global pricing model" }]);
    expect((await source()).allowedModels).toBe(JSON.stringify([prefix + "model"]));
    expect(JSON.stringify(result)).not.toContain("fixture-secret-unregistered");
  });
  it("rejects duplicate pricing identities while applying valid peers", async () => {
    await prisma.modelPricing.create({
      data: {
        model: prefix + "alias",
        provider: "openai",
        supportedFormats: "openai-chat-completions",
        inputPrice: 1,
        outputPrice: 1,
      },
    });
    const result = await apply({
      targets: [
        { channelId: channel, addModels: [prefix + "alias"] },
        { channelId: other, addModels: [prefix + "new"] },
      ],
    });
    expect(result.updated.map((row) => row.id)).toEqual([other]);
    expect(result.rejected).toEqual([{ id: channel, reason: "Duplicate request model identity" }]);
  });
  it("does not overwrite malformed stored restrictions", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { allowedModels: "invalid" } });
    const result = await apply();
    expect(result.rejected).toEqual([{ id: channel, reason: "Invalid stored model restriction" }]);
    expect((await source()).allowedModels).toBe("invalid");
  });
  it.each(["first", "last", "business-rejected"])(
    "Deny on %s cancels the entire batch before metadata hydration",
    async (kind) => {
      await grant(platformRelayChannelArn(kind === "first" ? channel : other));
      const rich = vi.spyOn(RelayChannelModelRestrictionRepository.getInstance(), "candidates"),
        input = body();
      if (kind === "business-rejected") input.targets[1]!.addModels = ["unknown"];
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
    await unchanged(() => RelayChannelService.getInstance().applyModelRestrictions(body(), actor));
  });
  it.each(["missing", "deleted", "alias"])("refuses %s channel target before any partial write", async (kind) => {
    const input = body();
    if (kind === "deleted") await prisma.relayChannel.update({ where: { id: other }, data: { status: 0 } });
    else input.targets[1]!.channelId = kind === "missing" ? "missing" : other.toUpperCase();
    await unchanged(() => apply(input));
  });
  it.each(["duplicate", "empty", "wildcard", "unknown-field"])("refuses invalid %s batch", async (kind) => {
    const input = body();
    if (kind === "duplicate") input.targets[1]!.channelId = channel;
    else if (kind === "empty") input.targets = [];
    else if (kind === "wildcard") input.targets[0]!.channelId = "*";
    else Object.assign(input, { accountId: owner });
    await unchanged(() => apply(input), 400);
  });
  it("rejects a stale target before entering the write phase", async () => {
    const repository = RelayChannelModelRestrictionRepository.getInstance(),
      original = repository.apply.bind(repository);
    vi.spyOn(repository, "apply").mockImplementation(async (...args) => {
      await prisma.relayChannel.update({ where: { id: other }, data: { allowedModels: null } });
      return original(...args);
    });
    await expect(apply()).rejects.toMatchObject({ statusCode: 403 });
    expect((await source()).allowedModels).toBe(JSON.stringify([prefix + "model"]));
  });
  it.each(["mode", "identity", "condition", "key", "session", "catalog", "response", "group"])(
    "rolls back all targets after late %s change",
    async (kind) => {
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
          else if (kind === "session")
            await tx.ramRoleSession.update({ where: { id: sessionId! }, data: { status: 0 } });
          else if (kind === "catalog")
            await tx.modelPricing.updateMany({ where: { model: prefix + "new" }, data: { status: 0 } });
          else if (kind === "group") await tx.group.update({ where: { id: groupId }, data: { permissions: [] } });
          else await tx.relayChannel.update({ where: { id: channel }, data: { multiplier: 4 } });
          return result;
        }) as unknown as typeof tx.relayChannel.updateMany);
      });
      await unchanged(() => apply(undefined, req));
    },
  );
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
  it.each(["legacy", "shadow"] as const)("%s writes only through original implementation", async (variant) => {
    env.security.iamAuthorizationMode = variant;
    const update = vi.spyOn(RelayChannelRepository.getInstance(), "updateById");
    expect((await apply()).updated).toHaveLength(2);
    expect(update).toHaveBeenCalledTimes(2);
  });
  it("writes only identifiers and counts to the audit log", async () => {
    await apply();
    const log = JSON.stringify(vi.mocked(BusinessLogService.getInstance().logOperation).mock.calls);
    expect(log).toContain(channel);
    expect(log).not.toMatch(/fixture-secret|openaiUpstream|allowedModels|customSetting/);
  });
  it("sanitizes unexpected transaction projection failures and rolls the full batch back", async () => {
    const resolver = (
      await import("@/services/relay/relay-pool-resolver.service")
    ).RelayPoolResolverService.getInstance();
    vi.spyOn(resolver, "resolveChannelCapabilities").mockRejectedValue(new Error("fixture-secret-internal"));
    const before = await channels();
    const error = await apply().catch((error: unknown) => error);
    expect(error).toMatchObject({ statusCode: 500 });
    expect(String(error)).not.toContain("fixture-secret-internal");
    expect(await channels()).toEqual(before);
  });
  it("all-business-rejected batches still require final authority and do not hydrate configuration responses", async () => {
    const repository = (
        await import("@/store/relay/relay-channel-configuration-read.repository")
      ).RelayChannelConfigurationReadRepository.getInstance(),
      read = vi.spyOn(repository, "read");
    const before = await channels(),
      result = await apply({
        targets: [
          { channelId: channel, addModels: ["unknown"] },
          { channelId: other, addModels: ["unknown"] },
        ],
      });
    expect(result.updated).toEqual([]);
    expect(result.rejected).toHaveLength(2);
    expect(read).not.toHaveBeenCalled();
    expect(await channels()).toEqual(before);
  });
  it("projects an updated pool and updated child only after the complete batch graph is final", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled", allowedModels: null, routingConfig: { allowedModelsMode: "auto" } },
    });
    await prisma.relayChannelMember.create({ data: { relayChannelId: channel, memberChannelId: other, priority: 0 } });
    const result = await apply();
    expect(result.updated.map((row) => row.id)).toEqual([channel, other]);
    expect(result.updated[0]!.allowedModels).toEqual([prefix + "new"]);
    expect(result.updated[1]!.allowedModels).toEqual([prefix + "model", prefix + "new"].sort());
  });
  it("does not return related leaf capabilities without the same Action on that leaf", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled", allowedModels: null, routingConfig: { allowedModelsMode: "auto" } },
    });
    await prisma.relayChannelMember.create({ data: { relayChannelId: channel, memberChannelId: other, priority: 0 } });
    const { req, role } = await roleRequest();
    await grant(platformRelayChannelArn(channel), "Allow", "role", role.id);
    const result = await apply({ targets: [{ channelId: channel, addModels: [prefix + "new"] }] }, req);
    expect(result.updated[0]!.allowedModels).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("fixture-secret-other");
    expect((await source()).allowedModels).toBe(JSON.stringify([prefix + "new"]));
  });
  it("rechecks a previously allowed related leaf after safe response projection", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled", allowedModels: null, routingConfig: { allowedModelsMode: "auto" } },
    });
    await prisma.relayChannelMember.create({ data: { relayChannelId: channel, memberChannelId: other, priority: 0 } });
    const resolver = (
        await import("@/services/relay/relay-pool-resolver.service")
      ).RelayPoolResolverService.getInstance(),
      resolve = resolver.resolveChannelCapabilities.bind(resolver);
    let projected = false;
    vi.spyOn(resolver, "resolveChannelCapabilities").mockImplementation(async (...args) => {
      const result = await resolve(...args);
      projected = true;
      return result;
    });
    const iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await authorize(input);
      return projected
        ? result.map((row, index) =>
            input.resources[index] === platformRelayChannelArn(other)
              ? { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] }
              : row,
          )
        : result;
    });
    await unchanged(() => apply({ targets: [{ channelId: channel, addModels: [prefix + "new"] }] }));
    expect(projected).toBe(true);
  });
});
