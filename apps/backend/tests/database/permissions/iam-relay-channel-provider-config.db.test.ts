import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayChannelProviderConfigRepository } from "@/store/relay/relay-channel-provider-config.repository";
import { RelayChannelConfigurationReadRepository } from "@/store/relay/relay-channel-configuration-read.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  platformRelayChannelArn,
  platformRelayChannelProviderArn,
} from "@/iam/resources/platform-relay-channel-resources";
import BusinessLogService from "@/services/system/businesslog.service";
import type { UpdateRelayChannelProviderConfigRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
import type { SubmissionProviderInput } from "@/store/relay/relay-channel-submission-create.repository";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:relay:UpdateChannelProviderConfig";
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
const body = (): UpdateRelayChannelProviderConfigRequest => ({
  multiplier: 0.8,
  providers: [
    { username: names[submitter]!, commissionPercent: 25, settlementMode: "interval", settlementIntervalDays: 3 },
  ],
});
const change = (input = body(), req = request(), id = channel) =>
  RelayChannelService.getInstance().updateProviderConfig(id, input, actor, req);
let names: Record<string, string>;
const source = () => prisma.relayChannel.findUniqueOrThrow({ where: { id: channel } });
const providers = () =>
  prisma.relayChannelProvider.findMany({ where: { relayChannelId: channel }, orderBy: { userId: "asc" } });
const resources = () => [
  platformRelayChannelArn(channel),
  platformRelayChannelProviderArn(channel, peer),
  platformRelayChannelProviderArn(channel, submitter),
];
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
  prefix = "provider-config-" + randomUUID();
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
  names = {};
  owner = await user();
  actor = await user(owner);
  submitter = await user();
  peer = await user();
  for (const id of [actor, peer, submitter])
    names[id] = (await prisma.user.findUniqueOrThrow({ where: { id }, select: { username: true } })).username;

  groupId = (
    await prisma.group.create({
      data: { username: prefix, name: prefix, accountOwnerId: null, permissions: [Permission.RELAY_CHANNEL_REVIEW] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  channel = (
    await prisma.relayChannel.create({
      data: {
        name: prefix,
        status: RELAY_CHANNEL_STATUS.DISABLED,
        submissionStatus: "pending",
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

describe("native scoped provider configuration", () => {
  it("replaces the selected provider relations and multiplier, preserving submission and service state", async () => {
    const before = await source(),
      result = await change();
    expect(result).toMatchObject({
      id: channel,
      multiplier: 0.8,
      enabled: false,
      submissionStatus: "pending",
      providerServiceEnabled: false,
    });
    expect(result.providers).toEqual([
      expect.objectContaining({
        userId: submitter,
        commissionPercent: 25,
        settlementMode: "interval",
        settlementIntervalDays: 3,
      }),
    ]);
    const rows = await providers();
    expect(rows.find((row) => row.userId === peer)?.status).toBe(0);
    expect(rows.find((row) => row.userId === submitter)?.nextSettlementAt).toBeInstanceOf(Date);
    expect(rows.some((row) => row.userId === actor)).toBe(false);
    expect(await source()).toMatchObject({
      submittedByUserId: before.submittedByUserId,
      status: before.status,
      submissionStatus: before.submissionStatus,
      openaiUpstreamApiKey: before.openaiUpstreamApiKey,
    });
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|verify/);
  });
  it.each([Permission.RELAY_CHANNEL_REVIEW, Permission.RELAY_CHANNEL_UPDATE])(
    "preserves either legacy eligibility %s",
    async (permission) => {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [permission] } });
      expect(await change()).toMatchObject({ multiplier: 0.8 });
    },
  );
  it("updates only the multiplier without requiring unrelated provider relation grants", async () => {
    const { req, role } = await roleRequest();
    await grant(platformRelayChannelArn(channel), "Allow", "role", role.id);
    const before = await providers();
    expect(await change({ multiplier: 0 }, req)).toMatchObject({ multiplier: 0 });
    expect(await providers()).toEqual(before);
  });
  it("does not add implicit submitter/actor when removing every provider", async () => {
    const { req, role } = await roleRequest();
    await grant(
      [platformRelayChannelArn(channel), platformRelayChannelProviderArn(channel, peer)],
      "Allow",
      "role",
      role.id,
    );
    const result = await change({ providers: [] }, req);
    expect(result.providers).toEqual([]);
    expect((await providers()).every((row) => row.status === 0)).toBe(true);
  });
  it("requires both removed and newly configured relations in JSON-only grants", async () => {
    const { req, role } = await roleRequest();
    await grant(platformRelayChannelArn(channel), "Allow", "role", role.id);
    await expect(change(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await grant(platformRelayChannelProviderArn(channel, submitter), "Allow", "role", role.id);
    await expect(change(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await grant(platformRelayChannelProviderArn(channel, peer), "Allow", "role", role.id);
    expect(await change(undefined, req)).toMatchObject({ multiplier: 0.8 });
  });
  it.each(["removed", "new"])(
    "explicit Deny on a %s relation prevents all writes and response hydration",
    async (kind) => {
      const before = await source(),
        rows = await providers();
      await grant(platformRelayChannelProviderArn(channel, kind === "removed" ? peer : submitter));
      const projection = vi.spyOn(RelayChannelConfigurationReadRepository.getInstance(), "read");
      await expect(change()).rejects.toMatchObject({ statusCode: 403 });
      expect(projection).not.toHaveBeenCalled();
      expect(await source()).toEqual(before);
      expect(await providers()).toEqual(rows);
    },
  );
  it("denies before resolving usernames or channel source when no Allow exists", async () => {
    const { req } = await roleRequest(),
      repo = RelayChannelProviderConfigRepository.getInstance(),
      lookup = vi.spyOn(repo, "providers"),
      candidate = vi.spyOn(repo, "candidate");
    await expect(change(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(lookup).not.toHaveBeenCalled();
    expect(candidate).not.toHaveBeenCalled();
  });
  it("preserves settled history and normalizes Decimal commission rounding on reactivation", async () => {
    const settled = new Date("2025-01-01T00:00:00Z");
    await prisma.relayChannelProvider.create({
      data: {
        relayChannelId: channel,
        userId: submitter,
        status: 0,
        commissionPercent: 90,
        settlementMode: "daily",
        settlementTime: "10:00",
        lastSettledAt: settled,
      },
    });
    const result = await change({
      providers: [{ username: names[submitter]!, commissionPercent: 0.1234567, settlementMode: "manual" }],
    });
    expect(result.providers[0]).toMatchObject({
      userId: submitter,
      commissionPercent: 0.123457,
      settlementMode: "manual",
    });
    expect((await providers()).find((row) => row.userId === submitter)).toMatchObject({
      status: 1,
      lastSettledAt: settled,
      nextSettlementAt: null,
      settlementTime: null,
    });
  });
  it("uses the existing interval/daily settlement scheduler", async () => {
    const before = Date.now();
    await change({
      providers: [
        { username: names[submitter]!, commissionPercent: 1, settlementMode: "interval", settlementIntervalDays: 2 },
        { username: names[peer]!, commissionPercent: 2, settlementMode: "daily", settlementTime: "09:30" },
      ],
    });
    const rows = await providers(),
      interval = rows.find((row) => row.userId === submitter)!,
      daily = rows.find((row) => row.userId === peer)!;
    expect(interval.nextSettlementAt!.getTime()).toBeGreaterThanOrEqual(before + 2 * 86400000);
    expect(daily.nextSettlementAt!.getTime()).toBeGreaterThan(before);
    expect(daily.nextSettlementAt!.toISOString().slice(11, 16)).toBe("01:30");
  });
  it("prepares every provider with one shared operation clock", async () => {
    const service = RelayChannelService.getInstance() as unknown as {
        buildProviderRow: (input: unknown, userId: string, now: Date) => SubmissionProviderInput;
      },
      prepare = vi.spyOn(service, "buildProviderRow");
    await change({
      providers: [
        { username: names[submitter]!, commissionPercent: 1, settlementMode: "interval", settlementIntervalDays: 2 },
        { username: names[peer]!, commissionPercent: 2, settlementMode: "interval", settlementIntervalDays: 2 },
      ],
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[0]![2]).toBe(prepare.mock.calls[1]![2]);
    const rows = (await providers()).filter((row) => row.status === 1);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.nextSettlementAt).toEqual(rows[1]!.nextSettlementAt);
  });
  it("refuses a prepared row targeting a different admitted recipient and rolls back the multiplier", async () => {
    const service = RelayChannelService.getInstance() as unknown as {
        buildProviderRow: (input: unknown, userId: string, now: Date) => SubmissionProviderInput;
      },
      original = service.buildProviderRow.bind(service),
      before = await source(),
      rows = await providers();
    vi.spyOn(service, "buildProviderRow").mockImplementation((input, userId, now) =>
      original(input, userId === submitter ? peer : submitter, now),
    );
    await expect(
      change({
        multiplier: 0.8,
        providers: [
          { username: names[submitter]!, commissionPercent: 1, settlementMode: "manual" },
          { username: names[peer]!, commissionPercent: 2, settlementMode: "manual" },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await source()).toEqual(before);
    expect(await providers()).toEqual(rows);
  });
  it("accepts an empty patch without changing related data", async () => {
    const before = await source(),
      rows = await providers();
    await change({});
    expect(await source()).toEqual(before);
    expect(await providers()).toEqual(rows);
  });
  it.each(["unknown", "disabled", "duplicate"])(
    "rejects %s proposed providers without partial multiplier writes",
    async (kind) => {
      const input = body(),
        before = await source();
      if (kind === "unknown") input.providers![0]!.username = "missing-user";
      else if (kind === "disabled") await prisma.user.update({ where: { id: submitter }, data: { status: 0 } });
      else input.providers!.push({ ...input.providers![0]! });
      await expect(change(input)).rejects.toMatchObject({ statusCode: 400 });
      expect(await source()).toEqual(before);
    },
  );
  it.each([
    { multiplier: -1 },
    { multiplier: 1001 },
    { providers: [{ username: "x", commissionPercent: 101, settlementMode: "manual" }] },
    { providers: [{ username: "x", commissionPercent: 1, settlementMode: "interval" }] },
  ])("rejects invalid configuration %#", async (input) => {
    await expect(change(input as UpdateRelayChannelProviderConfigRequest)).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each(["missing", "forged-owner", "forged-subject", "oauth"])("refuses %s authentication context", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.authContext;
    else if (kind === "forged-owner") req.authContext!.accountOwnerId = submitter;
    else if (kind === "forged-subject") req.authContext!.principalUserId = peer;
    else req.oauthAccessToken = {} as TypedRequest["oauthAccessToken"];
    await expect(change(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses missing native request", async () => {
    await expect(RelayChannelService.getInstance().updateProviderConfig(channel, body(), actor)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it.each(["owned-group", "adds-only"])("%s cannot mint platform eligibility", async (kind) => {
    await grant("*", "Allow");
    if (kind === "owned-group") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    else {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RELAY_CHANNEL_UPDATE] } });
    }
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "deleted", "case-alias"])("rejects %s targets", async (kind) => {
    let id = channel;
    if (kind === "missing") id = "missing";
    else if (kind === "deleted") await prisma.relayChannel.update({ where: { id }, data: { status: 0 } });
    else id = id.toUpperCase();
    await expect(change(undefined, undefined, id)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not trust body user IDs, status, reviewer, or action headers", async () => {
    const input = {
      ...body(),
      status: 1,
      reviewedByUserId: peer,
      providers: [{ username: names[submitter]!, userId: actor, commissionPercent: 1, settlementMode: "manual" }],
    } as unknown as UpdateRelayChannelProviderConfigRequest;
    expect(await change(input)).toMatchObject({
      enabled: false,
      submissionStatus: "pending",
      providers: [expect.objectContaining({ userId: submitter })],
    });
    expect((await source()).reviewedByUserId).toBeNull();
  });
  it("does not hydrate rich channels, token values or upstream credentials", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
      selects: unknown[] = [];
    transactionHook((tx) => {
      const read = tx.relayChannel.findMany.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "findMany").mockImplementation((args) => {
        selects.push(args?.select);
        return read(args);
      });
    });
    await change();
    expect(rich).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(JSON.stringify(selects)).not.toMatch(/UpstreamApiKey/);
  });
  it("returns only authorized pooled contributions", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled", allowedModels: null, routingConfig: { allowedModelsMode: "upstream" } },
    });
    await prisma.relayChannelMember.create({ data: { relayChannelId: channel, memberChannelId: other, priority: 0 } });
    await grant(platformRelayChannelArn(other));
    expect(await change()).toMatchObject({ poolMembers: [], allowedModels: [] });
  });
  it("rejects provider terms changed before acquiring locks even with unchanged updateTime", async () => {
    const repo = RelayChannelProviderConfigRepository.getInstance(),
      apply = repo.apply.bind(repo);
    vi.spyOn(repo, "apply").mockImplementation(async (...args) => {
      await prisma.relayChannelProvider.updateMany({
        where: { relayChannelId: channel },
        data: { commissionPercent: 99, updateTime: args[0].providers[0]!.updateTime },
      });
      return apply(...args);
    });
    await expect(change()).rejects.toMatchObject({ statusCode: 403 });
    expect(Number((await source()).multiplier)).toBe(1);
  });
  it.each([
    "policy",
    "request",
    "mode",
    "key",
    "group",
    "actor",
    "recipient",
    "session",
    "payload",
    "relation",
    "catalog",
  ])("rolls back provider changes, removals and multiplier on final %s changes", async (kind) => {
    const req = request(),
      before = await source(),
      rows = await providers();
    let changed = false;
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
      req.authContext!.subjectType = "access_key";
      req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    }
    let sessionId: string | undefined;
    if (kind === "session") {
      const role = await roleRequest();
      Object.assign(req.authContext!, role.req.authContext);
      sessionId = role.session.id;
      await grant(resources(), "Allow", "role", role.role.id);
    }
    transactionHook((tx) => {
      const resolver = RelayPoolResolverService.getInstance(),
        resolve = resolver.resolveChannelCapabilities.bind(resolver);
      vi.spyOn(resolver, "resolveChannelCapabilities").mockImplementation(async (...args) => {
        const result = await resolve(...args);
        if (!changed) {
          changed = true;
          if (kind === "policy")
            vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
              input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
            );
          else if (kind === "request") req.authContext!.accountOwnerId = submitter;
          else if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
          else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
          else if (kind === "group") await tx.group.update({ where: { id: groupId }, data: { permissions: [] } });
          else if (kind === "actor") await tx.user.update({ where: { id: actor }, data: { status: 0 } });
          else if (kind === "recipient") {
            const user = await tx.user.findUniqueOrThrow({ where: { id: submitter }, select: { updateTime: true } });
            await tx.user.update({
              where: { id: submitter },
              data: { username: prefix + "rename", updateTime: user.updateTime },
            });
          } else if (kind === "session")
            await tx.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
          else if (kind === "relation")
            await tx.relayChannelProvider.updateMany({
              where: { relayChannelId: channel, userId: submitter },
              data: { commissionPercent: 99 },
            });
          else if (kind === "catalog") {
            const model = await tx.modelPricing.findUniqueOrThrow({
              where: { model: prefix + "model" },
              select: { updateTime: true },
            });
            await tx.modelPricing.update({
              where: { model: prefix + "model" },
              data: { provider: "changed", updateTime: model.updateTime },
            });
          } else {
            const row = await tx.relayChannel.findUniqueOrThrow({
              where: { id: channel },
              select: { updateTime: true },
            });
            await tx.relayChannel.update({
              where: { id: channel },
              data: { openaiUpstreamUrl: "https://changed.invalid", updateTime: row.updateTime },
            });
          }
        }
        return result;
      });
    });
    await expect(change(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(changed).toBe(true);
    expect(await source()).toEqual(before);
    expect(await providers()).toEqual(rows);
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("sanitizes unexpected projection errors and rolls back all changes", async () => {
    const before = await source(),
      rows = await providers();
    let reached = false;
    vi.spyOn(RelayPoolResolverService.getInstance(), "resolveChannelCapabilities").mockImplementation(() => {
      reached = true;
      throw new Error("fixture-secret-provider");
    });
    let error: unknown;
    try {
      await change();
    } catch (failure) {
      error = failure;
    }
    expect(reached).toBe(true);
    expect(error).toMatchObject({ statusCode: 500 });
    expect(String(error)).not.toContain("fixture-secret-provider");
    expect(await source()).toEqual(before);
    expect(await providers()).toEqual(rows);
  });
  it("logs exactly one safe success without input usernames, URLs, credentials or commission values", async () => {
    await change();
    const log = vi.mocked(BusinessLogService.getInstance().logOperation);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/fixture-secret|https:|commissionPercent/);
  });
  it.each(["legacy", "shadow"] as const)(
    "%s preserves one original provider replacement, update and audit",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const update = vi.spyOn(RelayChannelRepository.getInstance(), "updateById"),
        replace = vi.spyOn(RelayChannelRepository.getInstance(), "replaceProvidersByChannelId"),
        native = vi.spyOn(RelayChannelConfigurationReadRepository.getInstance(), "read");
      expect(await change()).toMatchObject({ multiplier: 0.8 });
      expect(update).toHaveBeenCalledOnce();
      expect(replace).toHaveBeenCalledOnce();
      expect(native).not.toHaveBeenCalled();
      expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledOnce();
    },
  );
});
