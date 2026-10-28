import { getIamPrincipal } from "@/iam/request/principal-context";
import { platformRelayChannelChangeRequestReviewResourceResolver } from "@/iam/request/platform-relay-channel-change-request-resource-resolver";
import { randomUUID, createHash, createCipheriv, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayChannelChangeRequestReviewRepository } from "@/store/relay/relay-channel-change-request-review.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  platformRelayChannelArn,
  platformRelayChannelProviderArn,
} from "@/iam/resources/platform-relay-channel-resources";
import BusinessLogService from "@/services/system/businesslog.service";
import type { ReviewRelayChannelChangeRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
import { platformRelayChannelChangeRequestArn } from "@/iam/resources/relay-channel-change-request-resources";
import { RelayConfigService } from "@/services/relay/relay-config.service";
const masterKey = env.relay.channelChangeRequest.masterKey,
  legacyKey = env.relay.channelProbe.masterKey;
const mode = env.security.iamAuthorizationMode,
  action = "quyan:relay:ReviewChannelChangeRequest";
let owner: string,
  actor: string,
  submitter: string,
  peer: string,
  groupId: string,
  channel: string,
  other: string,
  prefix: string,
  proposalId: string,
  peerName: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const review = (input: ReviewRelayChannelChangeRequest = { action: "approve" }, req = request(), id = proposalId) =>
  RelayChannelService.getInstance().reviewChangeRequest(id, input, actor, req);
const source = () => prisma.relayChannel.findUniqueOrThrow({ where: { id: channel } });
const providers = () =>
  prisma.relayChannelProvider.findMany({ where: { relayChannelId: channel }, orderBy: { userId: "asc" } });
const proposal = () => prisma.relayChannelChangeRequest.findUniqueOrThrow({ where: { id: proposalId } });
const proposalResource = () => platformRelayChannelChangeRequestArn(channel, proposalId);
const resources = () => [
  proposalResource(),
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
  env.relay.channelChangeRequest.masterKey = "fixture-only-" + "x".repeat(64);
  prefix = "change-review-" + randomUUID();
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
  peerName = (await prisma.user.findUniqueOrThrow({ where: { id: peer } })).username;
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
  proposalId = (
    await prisma.relayChannelChangeRequest.create({
      data: {
        relayChannelId: channel,
        submittedByUserId: submitter,
        configSnapshot: {
          name: prefix + "-proposed",
          multiplier: 0.8,
          previousSubmissionStatus: "approved",
          previousChannelStatus: 1,
          previousProviderServiceEnabled: true,
        },
      },
    })
  ).id;
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined as never);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  env.relay.channelChangeRequest.masterKey = masterKey;
  env.relay.channelProbe.masterKey = legacyKey;
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

async function snapshot(extra: Prisma.InputJsonObject) {
  const row = await proposal();
  await prisma.relayChannelChangeRequest.update({
    where: { id: proposalId },
    data: { configSnapshot: { ...(row.configSnapshot as Prisma.JsonObject), ...extra } },
  });
}
function encrypt(credentials: object, legacy = false) {
  const iv = randomBytes(12),
    key = createHash("sha256")
      .update(legacy ? env.relay.channelProbe.masterKey : env.relay.channelChangeRequest.masterKey)
      .digest(),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  return {
    encryptedCredentials: Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()]).toString(
      "base64",
    ),
    credentialIv: iv.toString("base64"),
    credentialAuthTag: cipher.getAuthTag().toString("base64"),
  };
}
const proposedProvider = () => ({ username: peerName, commissionPercent: 22.25, settlementMode: "manual" });
async function proposedProviders(
  providers: Prisma.InputJsonValue = [proposedProvider()],
  bindings: Prisma.InputJsonValue = [{ userId: peer, username: peerName }],
) {
  await snapshot({ providers, providerBindings: bindings });
}
async function unchanged(operation: () => Promise<unknown>, statusCode = 403) {
  const before = await source(),
    beforeRequest = await proposal(),
    beforeProviders = await providers();
  await expect(operation()).rejects.toMatchObject({ statusCode });
  expect(await source()).toEqual(before);
  expect(await proposal()).toEqual(beforeRequest);
  expect(await providers()).toEqual(beforeProviders);
}
describe("native platform channel change-request review", () => {
  it("approves admitted fields without reviving an admin-disabled or provider-paused channel or hydrating stored keys", async () => {
    const broadRead = vi.spyOn(RelayConfigService.getInstance(), "getRelayConfig"),
      rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
      before = await providers();
    const result = await review({ action: "approve", reason: " reviewed " });
    expect(result).toMatchObject({
      id: proposalId,
      reviewStatus: "approved",
      reviewReason: "reviewed",
      config: { name: prefix + "-proposed", multiplier: 0.8 },
    });
    expect(await source()).toMatchObject({
      name: prefix + "-proposed",
      status: 2,
      providerServiceEnabled: false,
      visibilityMode: "hidden",
      openaiUpstreamApiKey: "fixture-secret-review",
    });
    expect(Number((await source()).multiplier)).toBe(0.8);
    expect(await providers()).toEqual(before);
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-secret|encryptedCredentials|providerBindings|previousSubmissionStatus|credentialIv/,
    );
    expect(broadRead).not.toHaveBeenCalled();
    expect(rich).not.toHaveBeenCalled();
  });
  it("replaces provider terms without implicitly adding the submitter and preserves settlement history", async () => {
    const last = new Date("2025-01-01T00:00:00Z");
    await prisma.relayChannelProvider.updateMany({ where: { relayChannelId: channel }, data: { lastSettledAt: last } });
    await proposedProviders();
    await review();
    const rows = await providers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: peer,
      status: 1,
      settlementMode: "manual",
      nextSettlementAt: null,
      lastSettledAt: last,
    });
    expect(Number(rows[0]!.commissionPercent)).toBe(22.25);
  });
  it("an explicit empty provider list disables all existing relations", async () => {
    await proposedProviders([], []);
    await review();
    expect((await providers()).every((row) => row.status === 0)).toBe(true);
  });
  it("legacy unpinned proposals still require the resolved recipient relation", async () => {
    await snapshot({ providers: [proposedProvider()] });
    const { req, role } = await roleRequest();
    await grant([proposalResource(), platformRelayChannelArn(channel)], "Allow", "role", role.id);
    await unchanged(() => review(undefined, req));
    await grant(platformRelayChannelProviderArn(channel, peer), "Allow", "role", role.id);
    expect(await review(undefined, req)).toMatchObject({ reviewStatus: "approved" });
  });
  it.each([false, true])("applies new credentials after admission, with legacy rotation=%s", async (legacy) => {
    if (legacy) env.relay.channelProbe.masterKey = "fixture-only-" + "l".repeat(64);
    await prisma.relayChannelChangeRequest.update({
      where: { id: proposalId },
      data: encrypt({ openaiUpstreamApiKey: "fixture-proposed-new" }, legacy),
    });
    await review();
    expect((await source()).openaiUpstreamApiKey).toBe("fixture-proposed-new");
  });
  it.each(["ciphertext", "model-catalog", "upstream-missing-key", "missing-recipient"])(
    "rejection does not validate/decrypt %s proposed settings",
    async (kind) => {
      if (kind === "ciphertext")
        await prisma.relayChannelChangeRequest.update({
          where: { id: proposalId },
          data: { encryptedCredentials: "invalid", credentialIv: "invalid", credentialAuthTag: "invalid" },
        });
      if (kind === "model-catalog") await snapshot({ allowedModels: JSON.stringify(["same", "same"]) });
      if (kind === "upstream-missing-key") {
        await snapshot({ allowedFormats: "anthropic", anthropicUpstreamUrl: "https://fixture.invalid/anthropic" });
      }
      if (kind === "missing-recipient")
        await snapshot({
          providers: [{ username: "no-such-provider", commissionPercent: 10, settlementMode: "manual" }],
        });
      const before = await source(),
        beforeProviders = await providers();
      expect(await review({ action: "reject", reason: " stale proposal " })).toMatchObject({
        reviewStatus: "rejected",
        reviewReason: "stale proposal",
      });
      const after = await source();
      expect({
        ...after,
        updateTime: before.updateTime,
        reviewedAt: before.reviewedAt,
        reviewedByUserId: before.reviewedByUserId,
        reviewReason: before.reviewReason,
      }).toEqual(before);
      expect(await providers()).toEqual(beforeProviders);
    },
  );
  it("rejection requires only request and channel grants, not revenue-relation grants", async () => {
    const { req, role } = await roleRequest();
    await proposedProviders();
    await grant([proposalResource(), platformRelayChannelArn(channel)], "Allow", "role", role.id);
    expect(await review({ action: "reject", reason: "not approved" }, req)).toMatchObject({ reviewStatus: "rejected" });
  });
  it.each(["approve", "reject"] as const)("%s restores recovery proposal lifecycle correctly", async (variant) => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { submissionStatus: "pending", status: 2, providerServiceEnabled: false },
    });
    await snapshot({
      previousSubmissionStatus: "rejected",
      previousChannelStatus: 2,
      previousProviderServiceEnabled: true,
    });
    await review({ action: variant, reason: "review" });
    expect(await source()).toMatchObject({
      submissionStatus: variant === "approve" ? "approved" : "rejected",
      status: variant === "approve" ? 1 : 2,
      providerServiceEnabled: true,
    });
  });
  it.each([
    { previousSubmissionStatus: "garbage" },
    { previousSubmissionStatus: 1 },
    { previousChannelStatus: 0 },
    { previousChannelStatus: "1" },
    { previousProviderServiceEnabled: "true" },
  ])("rejects untrusted previous-state metadata %#", async (extra) => {
    await snapshot(extra);
    await unchanged(() => review({ action: "reject", reason: "review" }));
  });
  it.each(["request", "channel", "retained", "removed", "added"])(
    "Deny on %s blocks the complete approval",
    async (kind) => {
      if (kind === "retained") await proposedProviders();
      if (kind === "removed") await proposedProviders([], []);
      if (kind === "added") {
        const name = (await prisma.user.findUniqueOrThrow({ where: { id: submitter } })).username;
        await proposedProviders(
          [{ username: name, commissionPercent: 0, settlementMode: "manual" }],
          [{ userId: submitter, username: name }],
        );
      }
      await grant(
        kind === "request"
          ? proposalResource()
          : kind === "channel"
            ? platformRelayChannelArn(channel)
            : platformRelayChannelProviderArn(channel, kind === "added" ? submitter : peer),
      );
      await unchanged(() => review());
    },
  );
  it("default denial reads only the narrow server relation, not proposal/configuration/credentials", async () => {
    const { req } = await roleRequest(),
      rich = vi.spyOn(RelayChannelChangeRequestReviewRepository.getInstance(), "candidate");
    await unchanged(() => review(undefined, req));
    expect(rich).not.toHaveBeenCalled();
  });
  it("grants a JSON-only assumed role the exact request and channel without implicit provider insertion", async () => {
    const { req, role } = await roleRequest();
    await grant(
      [proposalResource(), platformRelayChannelArn(channel), platformRelayChannelProviderArn(channel, peer)],
      "Allow",
      "role",
      role.id,
    );
    expect(await review(undefined, req)).toMatchObject({ reviewStatus: "approved" });
    expect((await providers()).some((row) => row.userId === submitter)).toBe(false);
  });
  it("trusts server condition context rather than forged action headers", async () => {
    const { req, role } = await roleRequest();
    await grant(resources(), "Allow", "role", role.id, { IpAddress: { "acs:SourceIp": "192.0.2.0/24" } });
    await unchanged(() => review(undefined, req));
    Object.defineProperty(req, "ip", { value: "192.0.2.1" });
    expect(await review(undefined, req)).toMatchObject({ reviewStatus: "approved" });
  });
  it.each(["owned-group", "adds-only"])("%s cannot mint deployment review eligibility", async (kind) => {
    await grant("*", "Allow");
    if (kind === "owned-group") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    else {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RELAY_CHANNEL_REVIEW] } });
    }
    await unchanged(() => review());
  });
  it.each(["missing", "forged-owner", "forged-subject", "oauth"])("refuses %s identity", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.authContext;
    else if (kind === "forged-owner") req.authContext!.accountOwnerId = submitter;
    else if (kind === "forged-subject") req.authContext!.principalUserId = peer;
    else req.oauthAccessToken = {} as TypedRequest["oauthAccessToken"];
    await unchanged(() => review(undefined, req));
  });
  it.each([
    "invalid-binding",
    "renamed-recipient",
    "invalid-provider",
    "missing-key",
    "decrypt-failure",
    "name-conflict",
  ])("refuses %s approval atomically", async (kind) => {
    if (kind === "invalid-binding")
      await proposedProviders([proposedProvider()], [{ userId: submitter, username: peerName }]);
    if (kind === "renamed-recipient") {
      await proposedProviders();
      await prisma.user.update({ where: { id: peer }, data: { username: prefix + "renamed" } });
    }
    if (kind === "invalid-provider")
      await snapshot({ providers: [{ username: "missing", commissionPercent: 20, settlementMode: "manual" }] });
    if (kind === "missing-key")
      await prisma.relayChannel.update({ where: { id: channel }, data: { openaiUpstreamApiKey: null } });
    if (kind === "decrypt-failure")
      await prisma.relayChannelChangeRequest.update({
        where: { id: proposalId },
        data: { encryptedCredentials: "invalid", credentialIv: "invalid", credentialAuthTag: "invalid" },
      });
    if (kind === "name-conflict")
      await snapshot({ name: (await prisma.relayChannel.findUniqueOrThrow({ where: { id: other } })).name });
    await unchanged(() => review(), kind === "invalid-binding" ? 403 : kind === "name-conflict" ? 409 : 400);
  });
  it("revalidates completed-review access and returns a safe idempotent response", async () => {
    await review();
    const before = await source(),
      old = await proposal();
    expect(await review()).toMatchObject({ reviewStatus: "approved" });
    expect(await source()).toEqual(before);
    expect(await proposal()).toEqual(old);
    await grant(proposalResource());
    await unchanged(() => review());
  });
  it.each(["source", "proposal", "recipient", "group", "actor"])(
    "refuses stale %s transaction context",
    async (kind) => {
      if (kind === "recipient") await proposedProviders();
      const repository = RelayChannelChangeRequestReviewRepository.getInstance(),
        original = repository.apply.bind(repository);
      vi.spyOn(repository, "apply").mockImplementation(async (...args) => {
        if (kind === "source") await prisma.relayChannel.update({ where: { id: channel }, data: { multiplier: 2 } });
        if (kind === "proposal")
          await prisma.relayChannelChangeRequest.update({
            where: { id: proposalId },
            data: { reviewReason: "changed" },
          });
        if (kind === "recipient") await prisma.user.update({ where: { id: peer }, data: { status: 0 } });
        if (kind === "group") await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
        if (kind === "actor") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
        return original(...args);
      });
      await expect(review()).rejects.toMatchObject({ statusCode: 403 });
      expect((await proposal()).reviewStatus).toBe("pending");
    },
  );
  it.each([
    "mode",
    "request",
    "condition",
    "key",
    "session",
    "source",
    "proposal",
    "recipient",
    "catalog",
    "response",
    "credentials",
    "credential-presence",
  ])("rolls back a late %s change", async (kind) => {
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
    const before = await source(),
      beforeRequest = await proposal(),
      beforeProviders = await providers();
    transactionHook((tx) => {
      const original = tx.relayChannelChangeRequest.updateMany.bind(tx.relayChannelChangeRequest);
      vi.spyOn(tx.relayChannelChangeRequest, "updateMany").mockImplementation((async (
        args: Prisma.RelayChannelChangeRequestUpdateManyArgs,
      ) => {
        const result = await original(args);
        if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
        else if (kind === "request") req.authContext!.accountOwnerId = peer;
        else if (kind === "condition") Object.defineProperty(req, "ip", { value: "192.0.2.9", configurable: true });
        else if (kind === "key") await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        else if (kind === "session") await tx.ramRoleSession.update({ where: { id: sessionId! }, data: { status: 0 } });
        else if (kind === "source") await tx.relayChannel.update({ where: { id: channel }, data: { multiplier: 3 } });
        else if (kind === "proposal")
          await tx.relayChannelChangeRequest.update({
            where: { id: proposalId },
            data: { reviewReason: "tampered" },
          });
        else if (kind === "recipient") await tx.user.update({ where: { id: peer }, data: { status: 0 } });
        else if (kind === "credentials")
          await tx.relayChannelChangeRequest.update({
            where: { id: proposalId },
            data: { encryptedCredentials: "changed" },
          });
        else if (kind === "credential-presence")
          await tx.relayChannel.update({ where: { id: channel }, data: { openaiUpstreamApiKey: null } });
        else if (kind === "catalog")
          await tx.modelPricing.updateMany({ where: { model: prefix + "model" }, data: { status: 0 } });
        else await tx.user.update({ where: { id: submitter }, data: { username: prefix + "changed" } });
        return result;
      }) as unknown as typeof tx.relayChannelChangeRequest.updateMany);
    });
    if (kind === "condition")
      await grant(resources(), "Deny", "user", actor, { IpAddress: { "acs:SourceIp": "192.0.2.0/24" } });
    await expect(review(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(await source()).toEqual(before);
    expect(await proposal()).toEqual(beforeRequest);
    expect(await providers()).toEqual(beforeProviders);
  });
  it.each(["legacy", "shadow"] as const)("%s performs only the original write", async (variant) => {
    env.security.iamAuthorizationMode = variant;
    const repository = RelayChannelRepository.getInstance(),
      update = vi.spyOn(repository, "updateById");
    expect(await review({ action: "reject", reason: "review" })).toMatchObject({ reviewStatus: "rejected" });
    expect(update).toHaveBeenCalledTimes(1);
  });
  it("records only safe audit identifiers", async () => {
    await review();
    const logs = JSON.stringify(vi.mocked(BusinessLogService.getInstance().logOperation).mock.calls);
    expect(logs).toContain(proposalId);
    expect(logs).not.toMatch(/fixture-secret|encryptedCredentials|configSnapshot|providerBindings/);
  });
  it.each(["request", "channel", "relation"])("rolls back a final %s policy decision change", async (kind) => {
    await proposedProviders();
    let written = false;
    transactionHook((tx) => {
      const original = tx.relayChannelChangeRequest.updateMany.bind(tx.relayChannelChangeRequest);
      vi.spyOn(tx.relayChannelChangeRequest, "updateMany").mockImplementation((async (
        args: Prisma.RelayChannelChangeRequestUpdateManyArgs,
      ) => {
        const result = await original(args);
        written = true;
        return result;
      }) as unknown as typeof tx.relayChannelChangeRequest.updateMany);
    });
    const iam = IamAuthorizationService.getInstance(),
      original = iam.authorizeMany.bind(iam),
      denied =
        kind === "request"
          ? proposalResource()
          : kind === "channel"
            ? platformRelayChannelArn(channel)
            : platformRelayChannelProviderArn(channel, peer);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const results = await original(input);
      return written
        ? results.map((result, index) =>
            input.resources[index] === denied
              ? { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] }
              : result,
          )
        : results;
    });
    await unchanged(() => review());
    expect(written).toBe(true);
  });
  it.each(["missing-iv", "unknown-property", "non-string", "empty-key"])(
    "refuses malformed encrypted credentials: %s",
    async (kind) => {
      const data =
        kind === "missing-iv"
          ? { encryptedCredentials: "fixture-only", credentialIv: null, credentialAuthTag: null }
          : encrypt(
              kind === "unknown-property"
                ? { status: 1 }
                : { openaiUpstreamApiKey: kind === "non-string" ? 123 : "   " },
            );
      await prisma.relayChannelChangeRequest.update({ where: { id: proposalId }, data });
      await unchanged(() => review(), 400);
    },
  );
  it.each(["missing", "case-alias", "deleted-request", "deleted-channel", "wrong-submitter", "pool"])(
    "refuses %s target identity",
    async (kind) => {
      let id = proposalId;
      if (kind === "missing") id = "no-such-proposal";
      else if (kind === "case-alias") id = id.toUpperCase();
      else if (kind === "deleted-request")
        await prisma.relayChannelChangeRequest.update({ where: { id }, data: { status: -1 } });
      else if (kind === "deleted-channel")
        await prisma.relayChannel.update({ where: { id: channel }, data: { status: 0 } });
      else if (kind === "wrong-submitter")
        await prisma.relayChannelChangeRequest.update({ where: { id }, data: { submittedByUserId: peer } });
      else await prisma.relayChannel.update({ where: { id: channel }, data: { channelType: "pooled" } });
      await unchanged(() => review(undefined, undefined, id));
    },
  );
  it.each([{ action: "reject", reason: " " }, { action: "invalid" }, { action: "approve", reason: "x".repeat(1001) }])(
    "rejects invalid review bodies %#",
    async (input) => {
      await unchanged(() => review(input as ReviewRelayChannelChangeRequest), 400);
    },
  );
  it("requires native request context", async () => {
    await unchanged(() =>
      RelayChannelService.getInstance().reviewChangeRequest(proposalId, { action: "approve" }, actor),
    );
  });
  it.each(["previousSubmissionStatus", "previousChannelStatus", "previousProviderServiceEnabled"])(
    "refuses explicit null restoration metadata: %s",
    async (key) => {
      await snapshot({ [key]: null });
      await unchanged(() => review({ action: "reject", reason: "review" }));
    },
  );
  it("requires a valid safe response structure even when rejecting", async () => {
    await snapshot({ name: 42 });
    await unchanged(() => review({ action: "reject", reason: "review" }), 400);
  });

  it("the route resolver uses only a narrow server link after eligibility and ignores client scope overrides", async () => {
    const req = request();
    req.params = { id: proposalId };
    req.query = { accountId: "forged", channelId: other };
    const candidate = vi.spyOn(RelayChannelChangeRequestReviewRepository.getInstance(), "candidate");
    expect(
      await platformRelayChannelChangeRequestReviewResourceResolver({ request: req, principal: getIamPrincipal(req)! }),
    ).toBe(proposalResource());
    expect(candidate).not.toHaveBeenCalled();
  });
  it("the route resolver refuses ineligible identities before looking up proposal relations", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    const req = request();
    req.params = { id: proposalId };
    const link = vi.spyOn(RelayChannelChangeRequestReviewRepository.getInstance(), "link");
    await expect(
      platformRelayChannelChangeRequestReviewResourceResolver({ request: req, principal: getIamPrincipal(req)! }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(link).not.toHaveBeenCalled();
  });
  it("the route resolver does not turn invalid identifiers into wildcard resources", async () => {
    const req = request();
    req.params = { id: "*" };
    const link = vi.spyOn(RelayChannelChangeRequestReviewRepository.getInstance(), "link");
    expect(
      await platformRelayChannelChangeRequestReviewResourceResolver({ request: req, principal: getIamPrincipal(req)! }),
    ).toBeUndefined();
    expect(link).not.toHaveBeenCalled();
  });
  it("applies one settlement clock to all proposed recipients while preserving inactive history", async () => {
    const submitterName = (await prisma.user.findUniqueOrThrow({ where: { id: submitter } })).username,
      oldSettlement = new Date("2024-01-02T00:00:00Z");
    await prisma.relayChannelProvider.create({
      data: {
        relayChannelId: channel,
        userId: submitter,
        status: 0,
        commissionPercent: 5,
        settlementMode: "manual",
        lastSettledAt: oldSettlement,
      },
    });
    await proposedProviders(
      [
        { username: peerName, commissionPercent: 20, settlementMode: "interval", settlementIntervalDays: 7 },
        { username: submitterName, commissionPercent: 10, settlementMode: "interval", settlementIntervalDays: 7 },
      ],
      [
        { userId: peer, username: peerName },
        { userId: submitter, username: submitterName },
      ],
    );
    await review();
    const rows = await providers();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 1 && row.nextSettlementAt instanceof Date)).toBe(true);
    expect(rows[0]!.nextSettlementAt).toEqual(rows[1]!.nextSettlementAt);
    expect(rows.find((row) => row.userId === submitter)!.lastSettledAt).toEqual(oldSettlement);
  });
});
