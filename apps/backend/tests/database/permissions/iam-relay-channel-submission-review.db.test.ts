import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS, type IamCondition } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayChannelSubmissionReviewRepository } from "@/store/relay/relay-channel-submission-review.repository";
import { RelayChannelConfigurationReadRepository } from "@/store/relay/relay-channel-configuration-read.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  platformRelayChannelArn,
  platformRelayChannelProviderArn,
} from "@/iam/resources/platform-relay-channel-resources";
import BusinessLogService from "@/services/system/businesslog.service";
import type { ReviewRelayChannelSubmissionRequest } from "@/api/dto/relay/relay-channel.dto";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:relay:ReviewChannelSubmission";
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
const review = (input: ReviewRelayChannelSubmissionRequest = { action: "approve" }, req = request(), id = channel) =>
  RelayChannelService.getInstance().reviewSubmittedChannel(id, input, actor, req);
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
  prefix = "submission-review-" + randomUUID();
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
describe("native platform submission review", () => {
  it("approves a real submission, adds the zero-share submitter and returns only credential-presence flags", async () => {
    const result = await review({ action: "approve", reason: "  reviewed  " });
    expect(result).toMatchObject({
      id: channel,
      enabled: true,
      providerServiceEnabled: true,
      submissionStatus: "approved",
      reviewReason: "reviewed",
      hasOpenaiUpstreamApiKey: true,
      allowedModels: [prefix + "model"],
    });
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: submitter, commissionPercent: 0, settlementMode: "manual" }),
        expect.objectContaining({ userId: peer, commissionPercent: 15 }),
      ]),
    );
    expect(await source()).toMatchObject({ reviewedByUserId: actor, submissionStatus: "approved", status: 1 });
    expect((await source()).reviewedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|verify/);
    expect((await providers()).every((row) => row.nextSettlementAt === null)).toBe(true);
    expect((await prisma.relayChannel.findUniqueOrThrow({ where: { id: other } })).submissionStatus).toBe("approved");
  });
  it.each(["reject", "offboard"] as const)(
    "%s leaves recipient configuration and provider service state unchanged",
    async (variant) => {
      const before = await providers();
      const result = await review({ action: variant, reason: " explanation " });
      expect(result).toMatchObject({
        enabled: false,
        providerServiceEnabled: false,
        submissionStatus: variant === "reject" ? "rejected" : "offboarded",
        reviewReason: "explanation",
      });
      expect(await providers()).toEqual(before);
    },
  );
  it("does not reset existing schedules when the submitter is already an active provider", async () => {
    await prisma.relayChannelProvider.create({
      data: { relayChannelId: channel, userId: submitter, commissionPercent: 5, settlementMode: "manual" },
    });
    const before = await providers();
    await review();
    expect(await providers()).toEqual(before);
  });
  it("reactivates a disabled implicit submitter relation without modifying historical fields", async () => {
    const historical = new Date("2025-01-01T00:00:00Z");
    await prisma.relayChannelProvider.create({
      data: {
        relayChannelId: channel,
        userId: submitter,
        status: 0,
        commissionPercent: 50,
        settlementMode: "interval",
        settlementIntervalDays: 5,
        lastSettledAt: historical,
      },
    });
    await review();
    expect((await providers()).find((row) => row.userId === submitter)).toMatchObject({
      status: 1,
      commissionPercent: expect.anything(),
      settlementMode: "manual",
      settlementIntervalDays: null,
      lastSettledAt: historical,
    });
    expect(Number((await providers()).find((row) => row.userId === submitter)!.commissionPercent)).toBe(0);
  });
  it("requires channel plus every recipient grant for JSON-only approval, without granting recipient IAM privileges", async () => {
    const { req, role } = await roleRequest();
    await grant(platformRelayChannelArn(channel), "Allow", "role", role.id);
    await expect(review(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await grant(platformRelayChannelProviderArn(channel, peer), "Allow", "role", role.id);
    await expect(review(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    await grant(platformRelayChannelProviderArn(channel, submitter), "Allow", "role", role.id);
    expect(await review(undefined, req)).toMatchObject({ enabled: true });
    for (const id of [peer, submitter])
      expect(
        await prisma.user.findUniqueOrThrow({
          where: { id },
          select: { accountOwnerId: true, permissionAdds: true, permissionRemoves: true },
        }),
      ).toEqual({ accountOwnerId: null, permissionAdds: [], permissionRemoves: [] });
  });
  it.each(["reject", "offboard"] as const)(
    "permits channel-only JSON grants for %s without activating recipient relations",
    async (variant) => {
      const { req, role } = await roleRequest();
      await grant(platformRelayChannelArn(channel), "Allow", "role", role.id);
      expect(await review({ action: variant, reason: "review" }, req)).toMatchObject({ enabled: false });
    },
  );
  it.each(["channel", "recipient", "implicit"])(
    "explicit Deny on %s blocks approval before configuration hydration",
    async (kind) => {
      await grant(
        kind === "channel"
          ? platformRelayChannelArn(channel)
          : platformRelayChannelProviderArn(channel, kind === "implicit" ? submitter : peer),
      );
      const before = await source(),
        beforeProviders = await providers(),
        projection = vi.spyOn(RelayChannelConfigurationReadRepository.getInstance(), "read");
      await expect(review()).rejects.toMatchObject({ statusCode: 403 });
      expect(await source()).toEqual(before);
      expect(await providers()).toEqual(beforeProviders);
      expect(projection).not.toHaveBeenCalled();
    },
  );
  it("default denial rejects before source metadata lookup", async () => {
    const { req } = await roleRequest(),
      candidate = vi.spyOn(RelayChannelSubmissionReviewRepository.getInstance(), "candidate");
    await expect(review(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(candidate).not.toHaveBeenCalled();
  });
  it("enforces trusted request conditions", async () => {
    const { req, role } = await roleRequest();
    await grant(resources(), "Allow", "role", role.id, { IpAddress: { "acs:SourceIp": "192.0.2.0/24" } });
    await expect(review(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    Object.defineProperty(req, "ip", { value: "192.0.2.1" });
    expect(await review(undefined, req)).toMatchObject({ enabled: true });
  });
  it.each(["owned-group", "adds-only"])("%s cannot mint platform eligibility", async (kind) => {
    await grant("*", "Allow");
    if (kind === "owned-group") await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
    else {
      await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
      await prisma.user.update({ where: { id: actor }, data: { permissionAdds: [Permission.RELAY_CHANNEL_REVIEW] } });
    }
    await expect(review()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "forged-owner", "forged-subject", "oauth"])("refuses %s request contexts", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.authContext;
    else if (kind === "forged-owner") req.authContext!.accountOwnerId = submitter;
    else if (kind === "forged-subject") req.authContext!.principalUserId = peer;
    else req.oauthAccessToken = {} as TypedRequest["oauthAccessToken"];
    await expect(review(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires a request in native modes", async () => {
    await expect(
      RelayChannelService.getInstance().reviewSubmittedChannel(channel, { action: "approve" }, actor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["missing", "deleted", "case-alias"])("rejects %s source identifiers", async (kind) => {
    let id = channel;
    if (kind === "missing") id = "missing";
    else if (kind === "case-alias") id = id.toUpperCase();
    else await prisma.relayChannel.update({ where: { id }, data: { status: 0 } });
    await expect(review(undefined, undefined, id)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses non-submitted channels", async () => {
    await expect(review(undefined, undefined, other)).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each([{ action: "reject", reason: " " }, { action: "invalid" }, { action: "approve", reason: "x".repeat(1001) }])(
    "rejects invalid review input %#",
    async (input) => {
      await expect(review(input as ReviewRelayChannelSubmissionRequest)).rejects.toMatchObject({ statusCode: 400 });
    },
  );
  it("blocks initial pending changes without reading their encrypted credentials", async () => {
    await prisma.relayChannelChangeRequest.create({
      data: {
        relayChannelId: channel,
        submittedByUserId: submitter,
        configSnapshot: {},
        encryptedCredentials: "fixture-encrypted-review",
      },
    });
    const before = await source(),
      project = vi.spyOn(RelayChannelConfigurationReadRepository.getInstance(), "read");
    await expect(review()).rejects.toMatchObject({ statusCode: 409 });
    expect(await source()).toEqual(before);
    expect(project).not.toHaveBeenCalled();
  });
  it("ignores client IDs, reviewer fields, status and X-Action overrides", async () => {
    const req = request();
    req.headers["x-action"] = "quyan:relay:channel:Update";
    expect(
      await review(
        {
          action: "reject",
          reason: "safe",
          status: 1,
          reviewedByUserId: peer,
          id: other,
        } as ReviewRelayChannelSubmissionRequest,
        req,
      ),
    ).toMatchObject({ id: channel, enabled: false, submissionStatus: "rejected" });
    expect((await source()).reviewedByUserId).toBe(actor);
  });
  it("runs its configuration projection within the same transaction, without rich record/credential/pricing reads", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById"),
      selects: unknown[] = [];
    transactionHook((tx) => {
      const read = tx.relayChannel.findMany.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "findMany").mockImplementation((args) => {
        selects.push(args?.select);
        return read(args);
      });
    });
    await review();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(rich).not.toHaveBeenCalled();
    expect(selects.length).toBeGreaterThan(0);
    expect(JSON.stringify(selects)).not.toMatch(/UpstreamApiKey/);
  });
  it("projects only admitted pool members and capabilities", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled", allowedModels: null, routingConfig: { allowedModelsMode: "upstream" } },
    });
    await prisma.relayChannelMember.create({ data: { relayChannelId: channel, memberChannelId: other, priority: 0 } });
    await grant(platformRelayChannelArn(other));
    const result = await review();
    expect(result.poolMembers).toEqual([]);
    expect(result.allowedModels).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(prefix + "other");
  });
  it("preserves admitted pooled model capabilities", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled", allowedModels: null, routingConfig: { allowedModelsMode: "upstream" } },
    });
    await prisma.relayChannelMember.create({ data: { relayChannelId: channel, memberChannelId: other, priority: 0 } });
    expect(await review()).toMatchObject({
      allowedModels: [prefix + "model"],
      poolMembers: [expect.objectContaining({ memberChannelId: other })],
    });
  });
  it.each(["binding", "commission"])("rejects a provider %s changed before locking", async (kind) => {
    const repo = RelayChannelSubmissionReviewRepository.getInstance(),
      apply = repo.apply.bind(repo);
    vi.spyOn(repo, "apply").mockImplementation(async (...args) => {
      await prisma.relayChannelProvider.updateMany({
        where: { relayChannelId: channel },
        data:
          kind === "binding" ? { status: 0 } : { commissionPercent: 99, updateTime: args[0].providers[0]!.updateTime },
      });
      return apply(...args);
    });
    await expect(review()).rejects.toMatchObject({ statusCode: 403 });
    expect((await source()).status).toBe(2);
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
    "credential",
    "catalog",
    "pending",
  ])("rolls back review, implicit provider and scheduling on final %s changes", async (kind) => {
    const req = request(),
      before = await source(),
      beforeProviders = await providers();
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
            const user = await tx.user.findUniqueOrThrow({ where: { id: peer }, select: { updateTime: true } });
            await tx.user.update({
              where: { id: peer },
              data: { username: prefix + "renamed", updateTime: user.updateTime },
            });
          } else if (kind === "session")
            await tx.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
          else if (kind === "pending")
            await tx.relayChannelChangeRequest.create({
              data: { relayChannelId: channel, submittedByUserId: submitter, configSnapshot: {} },
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
              data: {
                ...(kind === "payload"
                  ? { openaiUpstreamUrl: "https://changed.invalid" }
                  : { openaiUpstreamApiKey: null }),
                updateTime: row.updateTime,
              },
            });
          }
        }
        return result;
      });
    });
    await expect(review(undefined, req)).rejects.toMatchObject({ statusCode: 403 });
    expect(changed).toBe(true);
    expect(await source()).toEqual(before);
    expect(await providers()).toEqual(beforeProviders);
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("revalidates projected payload after the final authorization phase, even with unchanged metadata timestamps", async () => {
    const before = await source();
    let projected = false,
      changed = false,
      transaction: Prisma.TransactionClient | undefined;
    transactionHook((tx) => {
      transaction = tx;
      const resolver = RelayPoolResolverService.getInstance(),
        resolve = resolver.resolveChannelCapabilities.bind(resolver);
      vi.spyOn(resolver, "resolveChannelCapabilities").mockImplementation(async (...args) => {
        const result = await resolve(...args);
        projected = true;
        return result;
      });
    });
    const iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await authorize(input);
      if (projected && !changed) {
        changed = true;
        const row = await transaction!.relayChannel.findUniqueOrThrow({
          where: { id: channel },
          select: { updateTime: true },
        });
        await transaction!.relayChannel.update({
          where: { id: channel },
          data: { allowedModels: "[]", updateTime: row.updateTime },
        });
      }
      return result;
    });
    await expect(review()).rejects.toMatchObject({ statusCode: 403 });
    expect(changed).toBe(true);
    expect(await source()).toEqual(before);
    expect(await providers()).toHaveLength(1);
  });
  it("rechecks pooled contribution decisions after the final authorization phase", async () => {
    await prisma.relayChannel.update({
      where: { id: channel },
      data: { channelType: "pooled", allowedModels: null, routingConfig: { allowedModelsMode: "upstream" } },
    });
    await prisma.relayChannelMember.create({ data: { relayChannelId: channel, memberChannelId: other, priority: 0 } });
    const before = await source();
    let projected = false,
      changed = false;
    const resolver = RelayPoolResolverService.getInstance(),
      resolve = resolver.resolveChannelCapabilities.bind(resolver);
    vi.spyOn(resolver, "resolveChannelCapabilities").mockImplementation(async (...args) => {
      const result = await resolve(...args);
      projected = true;
      return result;
    });
    const iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const results = await authorize(input);
      // Change a contributing resource decision only after projection. The parent/revenue decisions still allow.
      if (projected) {
        changed = true;
        return results.map((result, index) =>
          input.resources[index] === platformRelayChannelArn(other)
            ? { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] }
            : result,
        );
      }
      return results;
    });
    await expect(review()).rejects.toMatchObject({ statusCode: 403 });
    expect(changed).toBe(true);
    expect(await source()).toEqual(before);
    expect(await providers()).toHaveLength(1);
  });
  it("sanitizes unexpected projection errors and rolls back all writes", async () => {
    const before = await source(),
      beforeProviders = await providers();
    let reached = false;
    vi.spyOn(RelayPoolResolverService.getInstance(), "resolveChannelCapabilities").mockImplementation(() => {
      reached = true;
      throw new Error("fixture-secret-review");
    });
    let failure: unknown;
    try {
      await review();
    } catch (error) {
      failure = error;
    }
    expect(reached).toBe(true);
    expect(failure).toMatchObject({ statusCode: 500 });
    expect(String(failure)).not.toContain("fixture-secret-review");
    expect(await source()).toEqual(before);
    expect(await providers()).toEqual(beforeProviders);
  });
  it("logs one safe success without keys, recipient identity permissions or review reason text", async () => {
    await review({ action: "approve", reason: "fixture-secret-review-comment" });
    const log = vi.mocked(BusinessLogService.getInstance().logOperation);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/fixture-secret|commissionPercent|permissionAdds/);
  });
  it.each(["legacy", "shadow"] as const)(
    "%s performs the old business update and audit once with no native configuration projection",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const old = vi.spyOn(RelayChannelRepository.getInstance(), "updateById"),
        native = vi.spyOn(RelayChannelConfigurationReadRepository.getInstance(), "read");
      expect(await review()).toMatchObject({ submissionStatus: "approved" });
      expect(old).toHaveBeenCalledOnce();
      expect(native).not.toHaveBeenCalled();
      expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledOnce();
    },
  );
});
