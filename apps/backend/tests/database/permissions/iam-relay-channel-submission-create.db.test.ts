import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayChannelSubmissionCreateRepository } from "@/store/relay/relay-channel-submission-create.repository";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { ModelPricingService } from "@/services/relay/model-pricing.service";
import { RelayConfigService } from "@/services/relay/relay-config.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import BusinessLogService from "@/services/system/businesslog.service";
import type { SubmitRelayChannelRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:CreateMyChannelSubmission",
  originalMode = env.security.iamAuthorizationMode;
let owner: string,
  actor: string,
  peer: string,
  foreign: string,
  groupId: string,
  prefix: string,
  names: Record<string, string>;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "quyan:relay:*" },
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const body = (extra: Partial<SubmitRelayChannelRequest> = {}): SubmitRelayChannelRequest => ({
  name: prefix,
  openaiUpstreamUrl: "https://submission-create.invalid/v1",
  openaiUpstreamApiKey: "fixture-secret-only",
  allowedFormats: "openai-chat-completions",
  allowedModels: JSON.stringify([prefix + "model"]),
  ...extra,
});
const create = (input = body(), req = request()) => RelayChannelService.getInstance().submitChannel(input, actor, req);
const owned = () =>
  prisma.relayChannel.findMany({
    where: { submittedByUserId: actor },
    select: { id: true, status: true, submissionStatus: true },
  });
const parent = (userId = actor) => "acs:relay:*:" + owner + ":channel-submission/" + userId + "/*";
const relation = (userId = actor, recipient = actor) =>
  "acs:relay:*:" + owner + ":submission-provider/" + userId + "/*/" + recipient;
const provider = (userId = peer) => ({
  username: names[userId]!,
  commissionPercent: 15,
  settlementMode: "manual" as const,
});
async function grant(
  Resource: string | string[],
  Effect: "Allow" | "Deny" = "Deny",
  principalType = "user",
  principalId = actor,
) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect, Action: action, Resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
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
function transactionHook(hook: (tx: Prisma.TransactionClient) => void) {
  const original = prisma.$transaction.bind(prisma);
  vi.spyOn(prisma, "$transaction").mockImplementation(((
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: object,
  ) =>
    typeof callback !== "function"
      ? original(callback as unknown as Prisma.PrismaPromise<unknown>[], options)
      : original(async (tx) => {
          hook(tx);
          return callback(tx);
        }, options)) as typeof prisma.$transaction);
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "submission-create-" + randomUUID();
  names = {};
  const user = async (accountOwnerId?: string) => {
    const row = await prisma.user.create({
      data: {
        username: prefix + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        parentUserId: accountOwnerId,
        userType: accountOwnerId ? "ram_user" : "root",
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    names[row.id] = row.username;
    return row.id;
  };
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
  groupId = (
    await prisma.group.create({
      data: { name: prefix, username: prefix, accountOwnerId: owner, permissions: [Permission.RELAY_CHANNEL_SUBMIT] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
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
  env.security.iamAuthorizationMode = originalMode;
  await prisma.relayChannel.deleteMany({
    where: { OR: [{ submittedByUserId: actor }, { name: { startsWith: prefix } }] },
  });
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, peer, foreign] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("native IAM channel submission creation", () => {
  it("reserves a server ID, creates a pending disabled standalone submission and adds the zero-share submitter", async () => {
    const result = await create();
    expect(result).toMatchObject({
      name: prefix,
      submissionStatus: "pending",
      channelType: "standalone",
      enabled: false,
      submittedByUserId: actor,
      providerServiceEnabled: true,
      hasOpenaiUpstreamApiKey: true,
      allowedModels: [prefix + "model"],
    });
    expect(result.providers).toEqual([
      expect.objectContaining({ userId: actor, commissionPercent: 0, settlementMode: "manual" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("fixture-secret-only");
    expect(await owned()).toEqual([
      { id: result.id, status: RELAY_CHANNEL_STATUS.DISABLED, submissionStatus: "pending" },
    ]);
    expect(result.poolMembers).toEqual([]);
    expect(result.pooledParentId).toBeUndefined();
  });
  it("uses dedicated Action and canonical reserved resources, never client identity/ID/approval overrides", async () => {
    const iam = IamAuthorizationService.getInstance(),
      authorize = vi.spyOn(iam, "authorizeMany");
    const input = {
      ...body(),
      id: "client-chosen-id",
      submittedByUserId: foreign,
      accountOwnerId: foreign,
      status: RELAY_CHANNEL_STATUS.ENABLED,
      submissionStatus: "approved",
      reviewedByUserId: foreign,
    };
    const result = await create(input);
    expect(result.id).not.toBe("client-chosen-id");
    expect(result.submittedByUserId).toBe(actor);
    expect(result.submissionStatus).toBe("pending");
    for (const [call] of authorize.mock.calls) {
      expect(call.action).toBe(action);
      expect(call.resources.every((resource) => resource.includes(":" + owner + ":"))).toBe(true);
    }
    expect(
      authorize.mock.calls.some(([call]) =>
        call.resources.includes(
          "acs:relay:*:" + owner + ":submission-provider/" + actor + "/" + result.id + "/" + actor,
        ),
      ),
    ).toBe(true);
  });
  it("supports JSON-only creation only when both the new channel and every proposed provider relation are allowed", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await grant(parent(), "Allow");
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(await owned()).toHaveLength(0);
    await grant(relation(), "Allow");
    expect(await create()).toMatchObject({ submissionStatus: "pending" });
  });
  it("checks all proposed providers before any channel or provider write", async () => {
    await grant(relation(actor, peer));
    const insert = vi.spyOn(prisma.relayChannel, "create");
    await expect(create(body({ providers: [provider()] }))).rejects.toMatchObject({ statusCode: 403 });
    expect(insert).not.toHaveBeenCalled();
    expect(await owned()).toHaveLength(0);
  });
  it("restricts JSON grants to a specific proposed recipient without granting foreign identity authority", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await grant([parent(), relation(), relation(actor, foreign)], "Allow");
    const result = await create(body({ providers: [provider(foreign)] }));
    expect(result.providers.map((row) => row.userId).sort()).toEqual([actor, foreign].sort());
    expect(result.submissionStatus).toBe("pending");
    const recipient = await prisma.user.findUniqueOrThrow({
      where: { id: foreign },
      select: { accountOwnerId: true, permissionAdds: true, permissionRemoves: true },
    });
    expect(recipient).toEqual({ accountOwnerId: null, permissionAdds: [], permissionRemoves: [] });
    await expect(create(body({ name: prefix + "-other", providers: [provider(peer)] }))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("honors explicit Deny on the channel before looking up provider names or model/configuration payloads", async () => {
    await grant(parent());
    const lookup = vi.spyOn(RelayChannelSubmissionCreateRepository.getInstance(), "providers");
    const pricing = vi.spyOn(prisma.modelPricing, "findMany");
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(lookup).not.toHaveBeenCalled();
    expect(pricing).not.toHaveBeenCalled();
  });
  it("default-denies before provider resolution without any Allow", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    const lookup = vi.spyOn(RelayChannelSubmissionCreateRepository.getInstance(), "providers");
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each(["missing", "account", "actor", "oauth"])("rejects forged %s identity bindings", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.authContext;
    if (kind === "account") req.authContext!.accountOwnerId = foreign;
    if (kind === "actor") req.user!.userId = peer;
    if (kind === "oauth") req.oauthAccessToken = { id: "fixture", userId: actor } as TypedRequest["oauthAccessToken"];
    await expect(create(body(), req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await owned()).toHaveLength(0);
  });
  it.each(["upstream", "format", "model-json", "channel-type"])(
    "rejects invalid %s input without persisting a submission",
    async (kind) => {
      const input = body();
      if (kind === "upstream") delete input.openaiUpstreamUrl;
      if (kind === "format") input.allowedFormats = "both";
      if (kind === "model-json") input.allowedModels = "{}";
      if (kind === "channel-type") Object.assign(input, { channelType: "pooled" });
      await expect(create(input)).rejects.toMatchObject({ statusCode: 400 });
      expect(await owned()).toHaveLength(0);
    },
  );
  it("rejects duplicate provider identities and unavailable recipients without exposing their data", async () => {
    await expect(create(body({ providers: [provider(), provider()] }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(create(body({ providers: [{ ...provider(), username: "missing-" + prefix }] }))).rejects.toMatchObject(
      { statusCode: 400 },
    );
    await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
    await expect(create(body({ providers: [provider()] }))).rejects.toMatchObject({ statusCode: 400 });
    expect(await owned()).toHaveLength(0);
  });
  it("preserves explicit self commission and interval/daily settlement without adding a second submitter row", async () => {
    const result = await create(
      body({
        providers: [
          { ...provider(actor), commissionPercent: 25, settlementMode: "interval", settlementIntervalDays: 3 },
          { ...provider(peer), settlementMode: "daily", settlementTime: "09:30" },
        ],
      }),
    );
    expect(result.providers).toHaveLength(2);
    expect(result.providers.find((row) => row.userId === actor)).toMatchObject({
      commissionPercent: 25,
      settlementMode: "interval",
      settlementIntervalDays: 3,
    });
    expect(result.providers.every((row) => row.nextSettlementAt)).toBe(true);
  });
  it("keeps business validators but uses only supplied model identity snapshots, never rich config/user/channel reads", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
      old = vi.spyOn(RelayChannelRepository.getInstance(), "create");
    const pricing = vi.spyOn(ModelPricingService.getInstance(), "getModelPricing"),
      config = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig");
    const reads: Prisma.RelayChannelFindUniqueArgs[] = [],
      catalogs: Prisma.ModelPricingFindManyArgs[] = [],
      inserts: Prisma.RelayChannelCreateArgs[] = [];
    transactionHook((tx) => {
      const read = tx.relayChannel.findUnique.bind(tx.relayChannel),
        catalog = tx.modelPricing.findMany.bind(tx.modelPricing),
        insert = tx.relayChannel.create.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "findUnique").mockImplementation((async (args) => {
        reads.push(args);
        return read(args);
      }) as typeof tx.relayChannel.findUnique);
      vi.spyOn(tx.modelPricing, "findMany").mockImplementation((async (args) => {
        if (!args) throw new Error("Missing catalog scope");
        catalogs.push(args);
        return catalog(args);
      }) as typeof tx.modelPricing.findMany);
      vi.spyOn(tx.relayChannel, "create").mockImplementation((async (args) => {
        inserts.push(args);
        return insert(args);
      }) as typeof tx.relayChannel.create);
    });
    await create();
    for (const spy of [rich, old, pricing, config]) expect(spy).not.toHaveBeenCalled();
    for (const read of reads) {
      expect(read.select).toBeTruthy();
      expect(read.include).toBeUndefined();
      for (const field of ["openaiUpstreamApiKey", "anthropicUpstreamApiKey", "geminiUpstreamApiKey"])
        expect(read.select).not.toHaveProperty(field);
    }
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.select).toEqual({ id: true });
    for (const read of catalogs) {
      expect(read.select).not.toHaveProperty("inputPrice");
      expect(read.select).not.toHaveProperty("outputPrice");
    }
    expect(JSON.stringify(vi.mocked(BusinessLogService.getInstance().logOperation).mock.calls)).not.toMatch(
      /fixture-secret-only|Upstream|Bearer/,
    );
  });
  it("keeps the model-identity duplicate validator on the narrow catalog", async () => {
    await expect(
      create(body({ allowedModels: JSON.stringify([prefix + "model", prefix + "model"]) })),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await owned()).toHaveLength(0);
  });
  it("preserves database commission rounding instead of mistaking it for a changed grant", async () => {
    const result = await create(body({ providers: [{ ...provider(), commissionPercent: 0.1234567 }] }));
    expect(result.providers.find((row) => row.userId === peer)).toMatchObject({ commissionPercent: 0.123457 });
  });
  it("accepts explicitly nullable mapping and rule inputs without retaining partial state", async () => {
    expect(
      await create(body({ modelMapping: null, timePeriodMultipliers: null, contextLengthMultipliers: null })),
    ).toMatchObject({ submissionStatus: "pending" });
  });
  it("rolls back provider failures and sanitizes unexpected persistence errors that may include supplied secrets", async () => {
    transactionHook((tx) => {
      vi.spyOn(tx.relayChannelProvider, "create").mockRejectedValueOnce(
        new Error("fixture-secret-only persistence invocation"),
      );
    });
    const failure = await create().then(
      () => undefined,
      (error) => error as Error & { statusCode?: number },
    );
    expect(failure).toMatchObject({ statusCode: 500 });
    expect(String(failure?.stack)).not.toContain("fixture-secret-only");
    expect(JSON.stringify(failure)).not.toContain("fixture-secret-only");
    expect(await owned()).toHaveLength(0);
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("serializes same-name creations and returns a conflict rather than duplicate pending submissions", async () => {
    const outcomes = await Promise.allSettled([create(), create()]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
    expect(await owned()).toHaveLength(1);
  });
  it.each([
    "request",
    "mode",
    "policy",
    "group",
    "actor",
    "provider",
    "provider-name",
    "provider-account",
    "payload",
    "credential-presence",
    "catalog",
    "relation",
    "key",
    "session",
  ])("rolls back channel and provider inserts after a final %s proof changes", async (kind) => {
    const req = request();
    let changed = false;
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
      req.authContext!.subjectType = "access_key";
      req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    }
    let sessionId: string | undefined;
    if (kind === "session") {
      const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } });
      const session = await prisma.ramRoleSession.create({
        data: {
          accountOwnerId: owner,
          roleId: role.id,
          subjectUserId: actor,
          sessionName: "fixture",
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      sessionId = session.id;
      req.authContext!.assumedRoleId = role.id;
      req.authContext!.roleSessionId = session.id;
      await grant([parent(), relation(), relation(actor, peer)], "Allow", "role", role.id);
    }
    transactionHook((tx) => {
      const resolver = RelayPoolResolverService.getInstance(),
        resolve = resolver.resolveChannelCapabilities.bind(resolver);
      vi.spyOn(resolver, "resolveChannelCapabilities").mockImplementation(async (...args) => {
        const result = await resolve(...args);
        if (!changed) {
          changed = true;
          if (kind === "request") req.authContext!.accountOwnerId = foreign;
          else if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
          else if (kind === "policy")
            vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
              input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
            );
          else if (kind === "group") {
            const row = await tx.group.findUniqueOrThrow({ where: { id: groupId }, select: { updateTime: true } });
            await tx.group.update({ where: { id: groupId }, data: { permissions: [], updateTime: row.updateTime } });
          } else if (kind === "actor") await tx.user.update({ where: { id: actor }, data: { status: 0 } });
          else if (kind === "provider") await tx.user.update({ where: { id: peer }, data: { status: 0 } });
          else if (kind === "provider-name" || kind === "provider-account") {
            const row = await tx.user.findUniqueOrThrow({ where: { id: peer }, select: { updateTime: true } });
            await tx.user.update({
              where: { id: peer },
              data: {
                updateTime: row.updateTime,
                ...(kind === "provider-name" ? { username: prefix + "changed" } : { accountOwnerId: foreign }),
              },
            });
          } else if (kind === "key")
            await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
          else if (kind === "session")
            await tx.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
          else if (kind === "catalog") {
            const row = await tx.modelPricing.findUniqueOrThrow({
              where: { model: prefix + "model" },
              select: { updateTime: true },
            });
            await tx.modelPricing.update({
              where: { model: prefix + "model" },
              data: { provider: "changed", updateTime: row.updateTime },
            });
          } else if (kind === "relation")
            await tx.relayChannelProvider.updateMany({
              where: { relayChannelId: args[0], userId: peer },
              data: { commissionPercent: 99 },
            });
          else {
            const row = await tx.relayChannel.findUniqueOrThrow({
              where: { id: args[0] },
              select: { updateTime: true },
            });
            await tx.relayChannel.update({
              where: { id: args[0] },
              data: {
                updateTime: row.updateTime,
                ...(kind === "payload" ? { name: prefix + "changed" } : { openaiUpstreamApiKey: "" }),
              },
            });
          }
        }
        return result;
      });
    });
    const failure = await create(body({ providers: [provider()] }), req).then(
      () => undefined,
      (error) => error as Error & { statusCode?: number },
    );
    expect(changed, failure?.stack).toBe(true);
    expect(failure).toMatchObject({ statusCode: 403 });
    expect(await owned()).toHaveLength(0);
    expect(await prisma.relayChannelProvider.count({ where: { userId: { in: [actor, peer] } } })).toBe(0);
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("does not inherit the user's submit permission into a role session", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } });
    const session = await prisma.ramRoleSession.create({
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
    await expect(create(body(), req)).rejects.toMatchObject({ statusCode: 403 });
    await grant([parent(), relation()], "Allow", "role", role.id);
    expect(await create(body(), req)).toMatchObject({ submissionStatus: "pending" });
  });
  it.each(["legacy", "shadow"] as const)(
    "%s performs the original create and audit once, not a second native write",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const old = vi.spyOn(RelayChannelRepository.getInstance(), "create");
      expect(await create()).toMatchObject({ submissionStatus: "pending" });
      expect(old).toHaveBeenCalledOnce();
      expect(await owned()).toHaveLength(1);
      expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledOnce();
    },
  );
});
