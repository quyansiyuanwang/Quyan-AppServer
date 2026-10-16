import { randomUUID, createHash, createDecipheriv } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayConfigService } from "@/services/relay/relay-config.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayChannelChangeRequestRepository } from "@/store/relay/relay-channel-change-request.repository";
import { RelayChannelChangeRequestCreateRepository } from "@/store/relay/relay-channel-change-request-create.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import {
  relayChannelSubmissionArn,
  relayChannelSubmissionProviderArn,
} from "@/iam/resources/relay-channel-submission-resources";
import { relayChannelChangeRequestArn } from "@/iam/resources/relay-channel-change-request-resources";
import BusinessLogService from "@/services/system/businesslog.service";
import type { CreateRelayChannelChangeRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  masterKey = env.relay.channelChangeRequest.masterKey,
  action = "quyan:relay:CreateMyChannelChangeRequest";
let owner: string,
  actor: string,
  peer: string,
  foreign: string,
  groupId: string,
  channel: string,
  prefix: string,
  names: Record<string, string>;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const body = (extra: Partial<CreateRelayChannelChangeRequest> = {}): CreateRelayChannelChangeRequest => ({
  name: prefix + "proposed",
  multiplier: 0.8,
  ...extra,
});
const create = (input = body(), req = request(), id = channel) =>
  RelayChannelService.getInstance().createChangeRequest(id, input, actor, req);
const source = () => prisma.relayChannel.findUniqueOrThrow({ where: { id: channel } });
const requests = () =>
  prisma.relayChannelChangeRequest.findMany({ where: { relayChannelId: channel }, orderBy: { id: "asc" } });
const parent = () => relayChannelSubmissionArn(owner, actor, channel);
const proposal = () => "acs:relay:*:" + owner + ":channel-change-request/" + actor + "/*";
const relation = (userId = peer) => relayChannelSubmissionProviderArn(owner, actor, channel, userId);
const provider = (userId = peer) => ({
  username: names[userId]!,
  commissionPercent: 12.5,
  settlementMode: "manual" as const,
});
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
async function pending(extra: Partial<Prisma.RelayChannelChangeRequestUncheckedCreateInput> = {}) {
  return prisma.relayChannelChangeRequest.create({
    data: {
      relayChannelId: channel,
      submittedByUserId: actor,
      reviewStatus: "pending",
      configSnapshot: { name: prefix + "old" },
      ...extra,
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
  env.relay.channelChangeRequest.masterKey = "fixture-only-" + "x".repeat(64);
  prefix = "change-create-" + randomUUID();
  names = {};
  const user = async (accountOwnerId?: string) => {
    const row = await prisma.user.create({
      data: {
        username: prefix + randomUUID(),
        password: "fixture-only",
        userType: accountOwnerId ? "ram_user" : "root",
        accountOwnerId,
        parentUserId: accountOwnerId,
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
      data: { username: prefix, name: prefix, accountOwnerId: owner, permissions: [Permission.RELAY_CHANNEL_SUBMIT] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  channel = (
    await prisma.relayChannel.create({
      data: {
        name: prefix,
        submittedByUserId: actor,
        submissionStatus: "approved",
        status: RELAY_CHANNEL_STATUS.ENABLED,
        providerServiceEnabled: true,
        allowedFormats: "openai-chat-completions",
        openaiUpstreamUrl: "https://fixture.invalid/v1",
        openaiUpstreamApiKey: "fixture-stored-secret",
        allowedModels: JSON.stringify([prefix + "model"]),
      },
    })
  ).id;
  await prisma.relayChannelProvider.create({
    data: {
      relayChannelId: channel,
      userId: actor,
      commissionPercent: 50,
      settlementMode: "manual",
      lastSettledAt: new Date("2025-01-01T00:00:00Z"),
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
  env.relay.channelChangeRequest.masterKey = masterKey;
  await prisma.relayChannel.deleteMany({ where: { id: channel } });
  await prisma.modelPricing.deleteMany({ where: { model: { startsWith: prefix } } });
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, peer, foreign] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("native owned channel change-request creation", () => {
  it("creates a pending proposal without changing the approved channel or its live providers", async () => {
    const before = await source(),
      providers = await prisma.relayChannelProvider.findMany({ where: { relayChannelId: channel } }),
      result = await create();
    expect(result).toMatchObject({
      relayChannelId: channel,
      submittedByUserId: actor,
      channelName: before.name,
      reviewStatus: "pending",
      config: { name: prefix + "proposed", multiplier: 0.8, hasOpenaiUpstreamApiKey: true },
    });
    expect(result.id).not.toBe(channel);
    expect(await source()).toEqual(before);
    expect(await prisma.relayChannelProvider.findMany({ where: { relayChannelId: channel } })).toEqual(providers);
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-stored-secret|providerBindings|previousSubmission|encryptedCredentials|credentialIv/,
    );
    const row = (await requests())[0]!;
    expect(row.encryptedCredentials).toBeNull();
    expect(row.configSnapshot).toMatchObject({
      previousSubmissionStatus: "approved",
      previousChannelStatus: 1,
      previousProviderServiceEnabled: true,
    });
  });
  it.each(["pending", "rejected"])("preserves %s recovery semantics without activating the channel", async (state) => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: {
        submissionStatus: state,
        status: RELAY_CHANNEL_STATUS.DISABLED,
        providerServiceEnabled: false,
        reviewReason: "fixture-reason",
      },
    });
    const before = await source();
    await create();
    const after = await source();
    if (state === "rejected") {
      expect(after).toMatchObject({
        submissionStatus: "pending",
        status: RELAY_CHANNEL_STATUS.DISABLED,
        reviewReason: null,
        providerServiceEnabled: false,
      });
      expect({
        ...after,
        updateTime: before.updateTime,
        submissionStatus: before.submissionStatus,
        reviewReason: before.reviewReason,
      }).toEqual(before);
    } else expect(after).toEqual(before);
  });
  it("records every cross-account proposed recipient identity without assigning providers or adding implicit self", async () => {
    const before = await prisma.relayChannelProvider.findMany({ where: { relayChannelId: channel } });
    const result = await create(body({ providers: [provider(foreign)] }));
    expect(result.config.providers).toEqual([provider(foreign)]);
    expect((await requests())[0]!.configSnapshot).toMatchObject({
      providerBindings: [{ username: names[foreign], userId: foreign }],
    });
    expect(await prisma.relayChannelProvider.findMany({ where: { relayChannelId: channel } })).toEqual(before);
  });
  it("records an explicit empty provider proposal without removing current providers", async () => {
    expect((await create(body({ providers: [] }))).config.providers).toEqual([]);
    expect((await requests())[0]!.configSnapshot).toMatchObject({ providerBindings: [] });
    expect(await prisma.relayChannelProvider.count({ where: { relayChannelId: channel, status: 1 } })).toBe(1);
  });
  it("encrypts only new credentials while preserving stored keys and safe presence flags", async () => {
    const result = await create(body({ openaiUpstreamApiKey: "  fixture-new-secret  " })),
      row = (await requests())[0]!;
    expect(result.config.hasOpenaiUpstreamApiKey).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-new-secret");
    expect(JSON.stringify(row.configSnapshot)).not.toContain("fixture-new-secret");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(env.relay.channelChangeRequest.masterKey).digest(),
      Buffer.from(row.credentialIv!, "base64"),
    );
    decipher.setAuthTag(Buffer.from(row.credentialAuthTag!, "base64"));
    expect(
      JSON.parse(
        Buffer.concat([decipher.update(Buffer.from(row.encryptedCredentials!, "base64")), decipher.final()]).toString(),
      ),
    ).toEqual({ openaiUpstreamApiKey: "fixture-new-secret" });
    expect((await source()).openaiUpstreamApiKey).toBe("fixture-stored-secret");
  });
  it.each(["anthropic", "gemini"] as const)(
    "validates %s credential presence independently without hydrating stored keys",
    async (provider) => {
      const input = body({
        allowedFormats: provider,
        [`${provider}UpstreamUrl`]: "https://fixture.invalid/" + provider,
      });
      await expect(create(input)).rejects.toMatchObject({ statusCode: 400 });
      expect(await requests()).toEqual([]);
      const result = await create({ ...input, [`${provider}UpstreamApiKey`]: "fixture-new-secret" });
      expect(result.config).toMatchObject(
        provider === "anthropic" ? { hasAnthropicUpstreamApiKey: true } : { hasGeminiUpstreamApiKey: true },
      );
      expect(JSON.stringify(result)).not.toContain("fixture-new-secret");
      expect(
        (await source())[provider === "anthropic" ? "anthropicUpstreamApiKey" : "geminiUpstreamApiKey"],
      ).toBeNull();
    },
  );
  it("treats blank new credential fields as unchanged and never serializes synthetic secrets", async () => {
    expect((await create(body({ openaiUpstreamApiKey: "   " }))).config.hasOpenaiUpstreamApiKey).toBe(true);
    expect((await requests())[0]!.encryptedCredentials).toBeNull();
  });
  it("uses a new key to satisfy presence without reading an absent stored key", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { openaiUpstreamApiKey: null } });
    expect((await create(body({ openaiUpstreamApiKey: "fixture-new-secret" }))).config.hasOpenaiUpstreamApiKey).toBe(
      true,
    );
    expect((await source()).openaiUpstreamApiKey).toBeNull();
  });
  it.each(["missing-key", "missing-encryption-key", "duplicate-model", "invalid-model-json"])(
    "rejects %s without superseding pending proposals",
    async (kind) => {
      await pending();
      const old = await requests();
      let input = body();
      if (kind === "missing-key")
        await prisma.relayChannel.update({ where: { id: channel }, data: { openaiUpstreamApiKey: null } });
      else if (kind === "missing-encryption-key") {
        env.relay.channelChangeRequest.masterKey = "";
        input = body({ openaiUpstreamApiKey: "fixture-new-secret" });
      } else
        input = body({
          allowedModels: kind === "duplicate-model" ? JSON.stringify([prefix + "model", prefix + "model"]) : "not-json",
        });
      await expect(create(input)).rejects.toMatchObject({ statusCode: 400 });
      expect(await requests()).toEqual(old);
    },
  );
  it("retains unregistered upstream model names without widening access to pricing or routing configuration", async () => {
    // Existing channels intentionally accept upstream names which have no local pricing identity.
    const result = await create(body({ allowedModels: JSON.stringify(["unregistered-upstream-name"]) }));
    expect(result.config.allowedModels).toBe(JSON.stringify(["unregistered-upstream-name"]));
  });
  it("uses trusted transport conditions and the fixed server Action rather than client headers", async () => {
    const { req, role } = await roleRequest();
    await grant([parent(), proposal()], "Allow", "role", role.id, { IpAddress: { "acs:SourceIp": "127.0.0.0/8" } });
    Object.defineProperty(req, "ip", { value: "192.0.2.1", configurable: true });
    await expect(create(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    Object.defineProperty(req, "ip", { value: "127.0.0.1", configurable: true });
    const evaluate = vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany");
    expect((await create(undefined, req)).reviewStatus).toBe("pending");
    for (const [input] of evaluate.mock.calls) expect(input.action).toBe(action);
  });
  it("supersedes every admitted pending request and leaves completed requests unchanged", async () => {
    const first = await pending(),
      second = await pending(),
      completed = await pending({ reviewStatus: "approved" }),
      result = await create();
    const rows = await requests();
    for (const id of [first.id, second.id])
      expect(rows.find((row) => row.id === id)).toMatchObject({
        status: -1,
        reviewStatus: "pending",
        reviewReason: "Superseded by a new submission",
      });
    expect(rows.find((row) => row.id === completed.id)).toEqual(completed);
    expect(rows.filter((row) => row.status === 1 && row.reviewStatus === "pending").map((row) => row.id)).toEqual([
      result.id,
    ]);
  });
  it("requires authorization for each superseded request, not only the newest one", async () => {
    const old = await pending();
    await pending();
    const before = await requests();
    await grant(relayChannelChangeRequestArn(owner, actor, old.id));
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(await requests()).toEqual(before);
  });
  it.each(["channel", "proposal", "provider"])("enforces ExplicitDeny on the %s resource", async (kind) => {
    await grant(kind === "channel" ? parent() : kind === "proposal" ? proposal() : relation());
    await expect(create(body({ providers: [provider()] }))).rejects.toMatchObject({ statusCode: 403 });
    expect(await requests()).toEqual([]);
  });
  it("uses role-only grants for the channel, reserved request and every proposed relation", async () => {
    const { req, role } = await roleRequest(),
      repo = RelayChannelChangeRequestCreateRepository.getInstance(),
      candidate = vi.spyOn(repo, "candidate");
    await expect(create(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(candidate).not.toHaveBeenCalled();
    await grant(parent(), "Allow", "role", role.id);
    await expect(create(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await grant(proposal(), "Allow", "role", role.id);
    await expect(create(body({ providers: [provider()] }), req)).rejects.toMatchObject({ statusCode: 403 });
    await grant(relation(), "Allow", "role", role.id);
    expect((await create(body({ providers: [provider()] }), req)).reviewStatus).toBe("pending");
  });
  it("denies before any metadata/provider lookups without a matching Allow", async () => {
    const { req } = await roleRequest(),
      repo = RelayChannelChangeRequestCreateRepository.getInstance(),
      metadata = vi.spyOn(repo, "candidate"),
      users = vi.spyOn(repo, "providers");
    await expect(create(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(metadata).not.toHaveBeenCalled();
    expect(users).not.toHaveBeenCalled();
  });
  it("cannot use a wildcard policy to propose changes to another submitter's channel", async () => {
    await prisma.relayChannel.update({ where: { id: channel }, data: { submittedByUserId: peer } });
    await grant("*", "Allow");
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect(await requests()).toEqual([]);
  });
  it.each(["missing", "deleted", "case-alias", "pooled", "offboarded"])("rejects %s channel sources", async (kind) => {
    let id = channel;
    if (kind === "missing") id = "missing";
    else if (kind === "case-alias") id = id.toUpperCase();
    else
      await prisma.relayChannel.update({
        where: { id },
        data:
          kind === "deleted"
            ? { status: RELAY_CHANNEL_STATUS.DELETED }
            : kind === "pooled"
              ? { channelType: "pooled" }
              : { submissionStatus: "offboarded" },
      });
    await expect(create(undefined, undefined, id)).rejects.toMatchObject({
      statusCode: ["pooled", "offboarded"].includes(kind) ? 400 : 403,
    });
    expect(await requests()).toEqual([]);
  });
  it.each(["missing", "owner", "subject", "oauth"])("refuses %s identity context", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.user;
    else if (kind === "owner") req.authContext!.accountOwnerId = foreign;
    else if (kind === "subject") req.authContext!.principalUserId = peer;
    else req.oauthAccessToken = { id: "fixture" } as TypedRequest["oauthAccessToken"];
    await expect(create(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await requests()).toEqual([]);
  });
  it.each(["missing-request", "unknown-mode"])("refuses %s instead of falling back", async (kind) => {
    if (kind === "unknown-mode") env.security.iamAuthorizationMode = "unknown" as typeof mode;
    await expect(
      RelayChannelService.getInstance().createChangeRequest(
        channel,
        body(),
        actor,
        kind === "missing-request" ? undefined : request(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["unknown", "disabled", "duplicate"])(
    "rejects %s proposed recipients without replacing the old request",
    async (kind) => {
      await pending();
      const before = await requests();
      let values = [provider()];
      if (kind === "unknown") values[0]!.username = "missing-user";
      else if (kind === "disabled") await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
      else values = [provider(), provider()];
      await expect(create(body({ providers: values }))).rejects.toMatchObject({ statusCode: 400 });
      expect(await requests()).toEqual(before);
    },
  );
  it("does not accept client-assigned IDs, ownership, previous state or recipient IDs", async () => {
    const input = {
      ...body(),
      id: "fake",
      accountOwnerId: foreign,
      submittedByUserId: peer,
      previousSubmissionStatus: "approved",
      providers: [{ ...provider(), userId: foreign }],
      hasOpenaiUpstreamApiKey: false,
    } as unknown as CreateRelayChannelChangeRequest;
    const result = await create(input);
    expect(result.id).not.toBe("fake");
    expect(result.submittedByUserId).toBe(actor);
    expect((await requests())[0]!.configSnapshot).toMatchObject({
      previousSubmissionStatus: "approved",
      providerBindings: [{ userId: peer, username: names[peer] }],
    });
  });
  it("uses narrow admitted source/catalog reads and a single transaction without rich/credential hydration", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
      legacy = vi.spyOn(RelayChannelChangeRequestRepository.getInstance(), "create"),
      config = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig"),
      selects: unknown[] = [];
    transactionHook((tx) => {
      const source = tx.relayChannel.findUnique.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "findUnique").mockImplementation((args) => {
        selects.push(args.select);
        return source(args);
      });
      const read = tx.relayChannelChangeRequest.findUnique.bind(tx.relayChannelChangeRequest);
      vi.spyOn(tx.relayChannelChangeRequest, "findUnique").mockImplementation((args) => {
        selects.push(args.select);
        return read(args);
      });
    });
    await create();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(rich).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
    expect(config).not.toHaveBeenCalled();
    expect(JSON.stringify(selects)).not.toMatch(/UpstreamApiKey|encryptedCredentials|credentialIv|credentialAuthTag/);
  });
  it("rejects a pending request changed before locking even if its updateTime is preserved", async () => {
    const old = await pending(),
      repo = RelayChannelChangeRequestCreateRepository.getInstance(),
      apply = repo.create.bind(repo);
    vi.spyOn(repo, "create").mockImplementation(async (...args) => {
      await prisma.relayChannelChangeRequest.update({
        where: { id: old.id },
        data: { reviewReason: "concurrent", updateTime: old.updateTime },
      });
      return apply(...args);
    });
    await expect(create()).rejects.toMatchObject({ statusCode: 403 });
    expect((await requests()).map((row) => row.id)).toEqual([old.id]);
  });
  it.each([
    "policy",
    "request",
    "mode",
    "key",
    "session",
    "actor",
    "owner",
    "recipient",
    "catalog",
    "source",
    "payload",
    "pending",
    "encrypted",
    "condition",
  ])("rolls back rejected-channel recovery, supersession and the new proposal on final %s changes", async (kind) => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: {
        submissionStatus: "rejected",
        status: RELAY_CHANNEL_STATUS.DISABLED,
        providerServiceEnabled: false,
        reviewReason: "fixture",
      },
    });
    const old = await pending(),
      before = await source(),
      oldRequests = await requests();
    let req = request(),
      sessionId: string | undefined;
    if (kind === "key") {
      const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
      req.authContext!.subjectType = "access_key";
      req.accessKey = { id: key.id } as TypedRequest["accessKey"];
    }
    if (kind === "session") {
      const role = await roleRequest();
      req = role.req;
      sessionId = role.session.id;
      await grant([parent(), proposal(), relation()], "Allow", "role", role.role.id);
    }
    if (kind === "condition")
      await grant([parent(), proposal(), relation()], "Deny", "user", actor, {
        IpAddress: { "acs:SourceIp": "192.0.2.0/24" },
      });
    let changed = false;
    transactionHook((tx) => {
      const read = tx.relayChannelChangeRequest.findUnique.bind(tx.relayChannelChangeRequest);
      vi.spyOn(tx.relayChannelChangeRequest, "findUnique").mockImplementation((async (args) => {
        const row = await read(args);
        if (args.select?.configSnapshot && row && !changed) {
          changed = true;
          if (kind === "policy")
            await tx.user.update({
              where: { id: actor },
              data: { permissionRemoves: [Permission.RELAY_CHANNEL_SUBMIT] },
            });
          else if (kind === "request") req.authContext!.accountOwnerId = foreign;
          else if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
          else if (kind === "condition") Object.defineProperty(req, "ip", { value: "192.0.2.1", configurable: true });
          else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
          else if (kind === "session")
            await tx.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
          else if (kind === "actor" || kind === "owner" || kind === "recipient")
            await tx.user.update({
              where: { id: kind === "actor" ? actor : kind === "owner" ? owner : peer },
              data: { status: 0 },
            });
          else if (kind === "catalog")
            await tx.modelPricing.updateMany({
              where: { model: prefix + "model" },
              data: { supportedFormats: "anthropic" },
            });
          else if (kind === "source")
            await tx.relayChannel.update({
              where: { id: channel },
              data: { name: prefix + "changed", updateTime: before.updateTime },
            });
          else if (kind === "payload")
            await tx.relayChannelChangeRequest.update({
              where: { id: row.id },
              data: { configSnapshot: { name: "changed" }, updateTime: row.updateTime },
            });
          else if (kind === "pending")
            await tx.relayChannelChangeRequest.update({ where: { id: old.id }, data: { status: 1 } });
          else
            await tx.relayChannelChangeRequest.update({
              where: { id: row.id },
              data: { encryptedCredentials: "changed" },
            });
        }
        return row;
      }) as typeof tx.relayChannelChangeRequest.findUnique);
    });
    await expect(
      create(body({ providers: [provider()], openaiUpstreamApiKey: "fixture-new-secret" }), req),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(changed).toBe(true);
    expect(await source()).toEqual(before);
    expect(await requests()).toEqual(oldRequests);
  });
  it("sanitizes unexpected normalization failures without exposing key values", async () => {
    const service = RelayChannelService.getInstance() as unknown as {
      buildValidatedChannelData: (...args: unknown[]) => Promise<unknown>;
    };
    vi.spyOn(service, "buildValidatedChannelData").mockRejectedValue(new Error("fixture-stored-secret"));
    const error = await create().catch((error: unknown) => error);
    expect(error).toMatchObject({ statusCode: 500 });
    expect(String(error)).not.toContain("fixture-stored-secret");
    expect(await requests()).toEqual([]);
  });
  it("canonicalizes case-insensitive usernames to the admitted recipient identity", async () => {
    const result = await create(body({ providers: [{ ...provider(), username: names[peer]!.toUpperCase() }] }));
    expect(result.config.providers).toEqual([provider()]);
    expect((await requests())[0]!.configSnapshot).toMatchObject({
      providerBindings: [{ userId: peer, username: names[peer] }],
    });
  });
  it("keeps pinned recipients valid when a new native proposal is approved through the compatibility path", async () => {
    const result = await create(body({ providers: [provider()] }));
    const reviewed = await RelayChannelService.getInstance().reviewChangeRequest(
      result.id,
      { action: "approve" },
      owner,
    );
    expect(reviewed.reviewStatus).toBe("approved");
    expect(
      await prisma.relayChannelProvider.findFirst({ where: { relayChannelId: channel, userId: peer, status: 1 } }),
    ).toMatchObject({ commissionPercent: expect.anything() });
  });
  it.each(["rebound", "disabled", "malformed"])(
    "refuses %s pinned recipients before compatibility approval writes",
    async (kind) => {
      const result = await create(body({ providers: [provider()] }));
      if (kind === "rebound") {
        await prisma.user.update({ where: { id: peer }, data: { username: prefix + "renamed" } });
        await prisma.user.update({ where: { id: foreign }, data: { username: names[peer] } });
      } else if (kind === "disabled") await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
      else {
        const row = (await requests())[0]!;
        await prisma.relayChannelChangeRequest.update({
          where: { id: row.id },
          data: {
            configSnapshot: {
              ...(row.configSnapshot as Prisma.InputJsonObject),
              providerBindings: [{ userId: foreign, username: names[peer]!, extra: true }],
            },
          },
        });
      }
      const before = await source(),
        oldRequests = await requests(),
        providers = await prisma.relayChannelProvider.findMany({ where: { relayChannelId: channel } });
      await expect(
        RelayChannelService.getInstance().reviewChangeRequest(result.id, { action: "approve" }, owner),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(await source()).toEqual(before);
      expect(await requests()).toEqual(oldRequests);
      expect(await prisma.relayChannelProvider.findMany({ where: { relayChannelId: channel } })).toEqual(providers);
    },
  );
  it("logs once with safe IDs/counts, never config, credentials, usernames or URLs", async () => {
    const audit = vi.spyOn(BusinessLogService.getInstance(), "logOperation");
    await create(body({ providers: [provider()], openaiUpstreamApiKey: "fixture-new-secret" }));
    expect(audit).toHaveBeenCalledOnce();
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/fixture-new-secret|fixture-stored-secret|fixture.invalid/);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(names[peer]);
  });
  it.each(["legacy", "shadow"] as const)(
    "%s performs only one original request creation without native persistence",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const legacy = vi.spyOn(RelayChannelChangeRequestRepository.getInstance(), "create"),
        native = vi.spyOn(RelayChannelChangeRequestCreateRepository.getInstance(), "create");
      expect((await create()).reviewStatus).toBe("pending");
      expect(legacy).toHaveBeenCalledOnce();
      expect(await requests()).toHaveLength(1);
      if (mode === "shadow") expect(native.mock.calls[0]![6]).toBe(false);
      else expect(native).not.toHaveBeenCalled();
    },
  );
});
