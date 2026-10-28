import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { RelayChannelSubmissionMutationRepository } from "@/store/relay/relay-channel-submission-mutation.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { relayChannelSubmissionArn } from "@/iam/resources/relay-channel-submission-resources";
import BusinessLogService from "@/services/system/businesslog.service";
import type { TypedRequest } from "@/types/express";
const originalMode = env.security.iamAuthorizationMode;
const actions = {
  delete: "quyan:relay:DeleteMyChannelSubmission",
  status: "quyan:relay:SetMyChannelSubmissionServiceStatus",
};
let owner: string,
  actor: string,
  peer: string,
  foreign: string,
  groupId: string,
  own: string,
  other: string,
  token: string,
  prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const service = () => RelayChannelService.getInstance();
const remove = (id = own, req = request()) => service().deleteSubmittedChannel(id, actor, req);
const status = (enabled = false, req = request(), id = own) =>
  service().updateSubmittedChannelServiceStatus(id, { enabled }, actor, req);
const state = () =>
  prisma.relayChannel.findUniqueOrThrow({
    where: { id: own },
    select: { status: true, providerServiceEnabled: true, submittedByUserId: true, updateTime: true },
  });
async function grant(
  action: string,
  resource: string,
  Effect: "Allow" | "Deny" = "Deny",
  type = "user",
  principalId = actor,
) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect, Action: action, Resource: resource } });
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: prefix + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: type,
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
  prefix = "submission-write-" + randomUUID();
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
  peer = await user(owner);
  foreign = await user();
  groupId = (
    await prisma.group.create({
      data: { name: prefix, username: prefix, accountOwnerId: owner, permissions: [Permission.RELAY_CHANNEL_SUBMIT] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  const channel = async (submittedByUserId: string) =>
    (
      await prisma.relayChannel.create({
        data: {
          name: prefix + randomUUID(),
          submittedByUserId,
          channelType: "standalone",
          submissionStatus: "approved",
          status: RELAY_CHANNEL_STATUS.ENABLED,
          visibilityMode: "private",
          openaiUpstreamApiKey: "fixture-secret-only",
          allowedFormats: "openai-chat-completions",
          providerServiceEnabled: true,
        },
      })
    ).id;
  own = await channel(actor);
  other = await channel(peer);
  token = (
    await prisma.relayToken.create({
      data: {
        userId: peer,
        name: prefix,
        token: prefix,
        channelId: own,
        automaticProxyPoolChannelId: own,
        routingMode: "automatic",
      },
    })
  ).id;
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined as never);
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = originalMode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayToken.deleteMany({ where: { id: token } });
  await prisma.relayChannelChangeRequest.deleteMany({ where: { relayChannelId: { in: [own, other] } } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: [own, other] } } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, peer, foreign] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("resource-scoped provider submission lifecycle", () => {
  it("pauses and resumes a private owned approved channel without platform authority or credential disclosure", async () => {
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "findVisibleById");
    expect(await status(false)).toMatchObject({
      id: own,
      providerServiceEnabled: false,
      serviceEnabled: false,
      hasOpenaiUpstreamApiKey: true,
    });
    expect(await status(true)).toMatchObject({ id: own, providerServiceEnabled: true });
    expect(rich).not.toHaveBeenCalled();
    expect(JSON.stringify(await status(false))).not.toContain("fixture-secret-only");
  });
  it.each(["pending", "rejected", "offboarded"])(
    "deletes owned %s submissions and cleans references atomically",
    async (submissionStatus) => {
      await prisma.relayChannel.update({ where: { id: own }, data: { submissionStatus } });
      await remove();
      expect((await state()).status).toBe(RELAY_CHANNEL_STATUS.DELETED);
      expect(
        await prisma.relayToken.findUnique({
          where: { id: token },
          select: { channelId: true, automaticProxyPoolChannelId: true, routingMode: true },
        }),
      ).toEqual({ channelId: null, automaticProxyPoolChannelId: null, routingMode: "ordered" });
    },
  );
  it("rejects deletion of an approved submission without touching token references", async () => {
    await expect(remove()).rejects.toMatchObject({ statusCode: 400 });
    expect((await state()).status).toBe(RELAY_CHANNEL_STATUS.ENABLED);
    expect((await prisma.relayToken.findUniqueOrThrow({ where: { id: token } })).channelId).toBe(own);
  });
  it("supports JSON-only write scopes without granting read or other lifecycle Actions", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await grant(actions.status, relayChannelSubmissionArn(owner, actor, own), "Allow");
    expect(await status(false)).toMatchObject({ id: own, providerServiceEnabled: false });
    await expect(remove()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["delete", "status"] as const)(
    "explicit Deny for %s overrides the legacy grant and rolls back writes",
    async (operation) => {
      await prisma.relayChannel.update({
        where: { id: own },
        data: { submissionStatus: operation === "delete" ? "pending" : "approved" },
      });
      await grant(actions[operation], relayChannelSubmissionArn(owner, actor, own));
      await expect(operation === "delete" ? remove() : status()).rejects.toMatchObject({ statusCode: 403 });
      expect((await state()).status).toBe(RELAY_CHANNEL_STATUS.ENABLED);
      expect((await state()).providerServiceEnabled).toBe(true);
    },
  );
  it.each(["delete", "status"] as const)(
    "wildcard %s never permits another submitter's resource",
    async (operation) => {
      await grant(actions[operation], "*", "Allow");
      await expect(operation === "delete" ? remove(other) : status(false, request(), other)).rejects.toMatchObject({
        statusCode: 403,
      });
    },
  );
  it.each(["missing", "account", "actor", "oauth"])("rejects forged %s request context", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.authContext;
    if (kind === "account") req.authContext!.accountOwnerId = foreign;
    if (kind === "actor") req.user!.userId = peer;
    if (kind === "oauth") req.oauthAccessToken = { id: "fixture", userId: actor } as TypedRequest["oauthAccessToken"];
    await expect(status(false, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["pending", "rejected", "offboarded"])(
    "does not pause an unapproved %s submission",
    async (submissionStatus) => {
      await prisma.relayChannel.update({ where: { id: own }, data: { submissionStatus } });
      await expect(status()).rejects.toMatchObject({ statusCode: 400 });
    },
  );
  it("cannot resume an administrator-disabled channel but can keep it paused", async () => {
    await prisma.relayChannel.update({ where: { id: own }, data: { status: RELAY_CHANNEL_STATUS.DISABLED } });
    await expect(status(true)).rejects.toMatchObject({ statusCode: 409 });
    expect(await status(false)).toMatchObject({ providerServiceEnabled: false });
  });
  it("fails closed for historical pool submissions", async () => {
    await prisma.relayChannel.update({ where: { id: own }, data: { channelType: "pool" } });
    await expect(status()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects noncanonical case aliases even when MySQL considers their IDs equal", async () => {
    const alias = own.toUpperCase();
    expect(alias).not.toBe(own);
    await expect(status(false, request(), alias)).rejects.toMatchObject({ statusCode: 403 });
    expect((await state()).providerServiceEnabled).toBe(true);
  });
  it("default-denies without any JSON or legacy Allow", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await expect(status()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["request", "mode", "policy", "ownership", "payload", "credential-presence", "owner", "key", "session"])(
    "rolls back the write when %s changes during response projection",
    async (kind) => {
      const req = request();
      let changed = false;
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, name: prefix, key: prefix, status: 1 } });
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
        await grant(actions.status, relayChannelSubmissionArn(owner, actor, own), "Allow", "role", role.id);
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
                input.resources.map(() => ({
                  decision: "ExplicitDeny",
                  reason: "explicit-deny",
                  matchedStatements: [],
                })),
              );
            else if (kind === "owner") await tx.user.update({ where: { id: owner }, data: { status: 0 } });
            else if (kind === "key")
              await tx.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
            else if (kind === "session")
              await tx.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
            else {
              const row = await tx.relayChannel.findUniqueOrThrow({ where: { id: own }, select: { updateTime: true } });
              await tx.relayChannel.update({
                where: { id: own },
                data: {
                  updateTime: row.updateTime,
                  ...(kind === "ownership"
                    ? { submittedByUserId: peer }
                    : kind === "payload"
                      ? { name: "changed" }
                      : { openaiUpstreamApiKey: "" }),
                },
              });
            }
          }
          return result;
        });
      });
      const failure = await status(false, req).then(
        () => undefined,
        (error) => error as Error & { statusCode?: number },
      );
      expect(changed, failure?.stack).toBe(true);
      expect(failure).toMatchObject({ statusCode: 403 });
      expect((await state()).providerServiceEnabled).toBe(true);
      expect((await state()).submittedByUserId).toBe(actor);
    },
  );
  it.each(["request", "policy", "ownership", "failure"])(
    "rolls back deletion and reference cleanup after final %s changes",
    async (kind) => {
      await prisma.relayChannel.update({ where: { id: own }, data: { submissionStatus: "pending" } });
      const req = request();
      let changed = false;
      transactionHook((tx) => {
        const original = tx.relayChannelChangeRequest.updateMany.bind(tx.relayChannelChangeRequest);
        vi.spyOn(tx.relayChannelChangeRequest, "updateMany").mockImplementation((async (...args) => {
          const result = await original(...args);
          if (!changed) {
            changed = true;
            if (kind === "request") req.authContext!.accountOwnerId = foreign;
            else if (kind === "policy")
              vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
                input.resources.map(() => ({
                  decision: "ExplicitDeny",
                  reason: "explicit-deny",
                  matchedStatements: [],
                })),
              );
            else if (kind === "ownership") {
              const row = await tx.relayChannel.findUniqueOrThrow({ where: { id: own }, select: { updateTime: true } });
              await tx.relayChannel.update({
                where: { id: own },
                data: { submittedByUserId: peer, updateTime: row.updateTime },
              });
            } else throw new Error("fixture cleanup failure");
          }
          return result;
        }) as typeof tx.relayChannelChangeRequest.updateMany);
      });
      const failure = await remove(own, req).then(
        () => undefined,
        (error) => error as Error & { statusCode?: number },
      );
      expect(changed, failure?.stack).toBe(true);
      if (kind === "failure") expect(failure?.message).toBe("fixture cleanup failure");
      else expect(failure).toMatchObject({ statusCode: 403 });
      expect(await state()).toMatchObject({ status: RELAY_CHANNEL_STATUS.ENABLED, submittedByUserId: actor });
      expect(
        await prisma.relayToken.findUnique({
          where: { id: token },
          select: { channelId: true, automaticProxyPoolChannelId: true },
        }),
      ).toEqual({ channelId: own, automaticProxyPoolChannelId: own });
      expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
    },
  );
  it("does not let the account owner bypass persisted submitter ownership", async () => {
    const req = request();
    req.user!.userId = owner;
    req.authContext!.principalUserId = owner;
    await expect(service().deleteSubmittedChannel(own, owner, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires role-only write authority rather than inheriting user grants", async () => {
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
    await expect(status(false, req)).rejects.toMatchObject({ statusCode: 403 });
    await grant(actions.status, relayChannelSubmissionArn(owner, actor, own), "Allow", "role", role.id);
    expect(await status(false, req)).toMatchObject({ providerServiceEnabled: false });
  });
  it("uses only narrow configuration and credential-presence reads for admitted resources", async () => {
    const reads: Prisma.RelayChannelFindFirstArgs[] = [];
    transactionHook((tx) => {
      const original = tx.relayChannel.findFirst.bind(tx.relayChannel);
      vi.spyOn(tx.relayChannel, "findFirst").mockImplementation((async (args) => {
        if (!args) throw new Error("Expected a scoped configuration query");
        reads.push(args);
        return original(args);
      }) as typeof tx.relayChannel.findFirst);
    });
    await status();
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.include).toBeUndefined();
      expect(read.select).toBeTruthy();
      expect(read.where).toMatchObject({ id: own, submittedByUserId: actor });
      for (const field of ["openaiUpstreamApiKey", "anthropicUpstreamApiKey", "geminiUpstreamApiKey"])
        expect(read.select).not.toHaveProperty(field);
    }
    const log = vi.mocked(BusinessLogService.getInstance().logOperation).mock.calls;
    expect(JSON.stringify(log)).not.toMatch(/fixture-secret-only|Upstream|password|Bearer/);
  });
  it("rejects a stale target snapshot before writes", async () => {
    const repository = RelayChannelSubmissionMutationRepository.getInstance(),
      target = repository.target.bind(repository);
    let changed = false;
    vi.spyOn(repository, "target").mockImplementation(async (...args) => {
      const row = await target(...args);
      if (!args[2] && !changed) {
        changed = true;
        await prisma.relayChannel.update({ where: { id: own }, data: { submittedByUserId: peer } });
      }
      return row;
    });
    await expect(status()).rejects.toMatchObject({ statusCode: 403 });
    expect(changed).toBe(true);
    expect((await state()).providerServiceEnabled).toBe(true);
  });
  it.each(["legacy", "shadow"] as const)("%s executes the old mutation exactly once", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const old = vi.spyOn(RelayChannelRepository.getInstance(), "updateById");
    expect(await status()).toMatchObject({ providerServiceEnabled: false });
    expect(old).toHaveBeenCalledOnce();
    expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledOnce();
  });
});
