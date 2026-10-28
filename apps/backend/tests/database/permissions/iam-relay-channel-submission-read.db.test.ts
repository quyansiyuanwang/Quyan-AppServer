import * as credentialPresence from "@/store/relay/relay-channel-credential-presence";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission, RELAY_CHANNEL_STATUS } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelRepository } from "@/store/relay/relay-channel.repository";
import { RelayPoolResolverService } from "@/services/relay/relay-pool-resolver.service";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { relayChannelSubmissionArn } from "@/iam/resources/relay-channel-submission-resources";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:ListMyChannelSubmissions",
  mode = env.security.iamAuthorizationMode;
let owner: string,
  actor: string,
  peer: string,
  foreign: string,
  groupId: string,
  ids: string[],
  others: string[],
  prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const list = (page = 1, pageSize = 20, req = request()) =>
  RelayChannelService.getInstance().listMySubmittedChannels(actor, page, pageSize, req);
async function grant(resource: string, Effect: "Allow" | "Deny" = "Deny", principal = { type: "user", id: actor }) {
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
      principalType: principal.type,
      principalId: principal.id,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
function interceptReads(transform?: (tx: Prisma.TransactionClient) => void) {
  const transact = prisma.$transaction.bind(prisma),
    reads: Prisma.RelayChannelFindManyArgs[] = [];
  const presence: { ids: readonly string[]; flags: unknown }[] = [];
  const originalPresence = vi.isMockFunction(credentialPresence.readRelayChannelCredentialPresence)
    ? vi.mocked(credentialPresence.readRelayChannelCredentialPresence).getMockImplementation()!
    : credentialPresence.readRelayChannelCredentialPresence;
  vi.spyOn(credentialPresence, "readRelayChannelCredentialPresence").mockImplementation(async (tx, ids) => {
    const flags = await originalPresence(tx, ids);
    presence.push({ ids, flags: [...flags] });
    return flags;
  });
  vi.spyOn(prisma, "$transaction").mockImplementation(((
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: object,
  ) =>
    typeof callback !== "function"
      ? transact(callback as unknown as Prisma.PrismaPromise<unknown>[], options)
      : transact(async (tx) => {
          const read = tx.relayChannel.findMany.bind(tx.relayChannel);
          vi.spyOn(tx.relayChannel, "findMany").mockImplementation((async (args: Prisma.RelayChannelFindManyArgs) => {
            reads.push(args);
            return read(args);
          }) as typeof tx.relayChannel.findMany);
          transform?.(tx);
          return callback(tx);
        }, options)) as typeof prisma.$transaction);
  return { reads, presence };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "submission-read-" + randomUUID();
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
  const create = async (submittedByUserId: string, n: number, status: number = RELAY_CHANNEL_STATUS.DISABLED) =>
    (
      await prisma.relayChannel.create({
        data: {
          name: prefix + n,
          submittedByUserId,
          channelType: "standalone",
          submissionStatus: n === 1 ? "approved" : n === 2 ? "rejected" : "pending",
          status,
          openaiUpstreamUrl: "https://fixture.invalid/" + n,
          openaiUpstreamApiKey: "fixture-secret-key",
          anthropicUpstreamApiKey: "",
          geminiUpstreamApiKey: " ",
          allowedFormats: "openai-chat-completions",
          allowedModels: JSON.stringify([prefix + "model"]),
          visibilityMode: "private",
          createTime: new Date(Date.UTC(2026, 9, 16, 0, 0, n)),
        },
      })
    ).id;
  ids = [await create(actor, 3), await create(actor, 2), await create(actor, 1)];
  others = [await create(peer, 4), await create(foreign, 5), await create(actor, 6, RELAY_CHANNEL_STATUS.DELETED)];
  await prisma.modelPricing.create({
    data: {
      model: prefix + "model",
      provider: "openai",
      supportedFormats: "openai-chat-completions",
      inputPrice: 1,
      outputPrice: 2,
    },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = mode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramRole.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayChannel.deleteMany({ where: { id: { in: [...ids, ...others] } } });
  await prisma.modelPricing.deleteMany({ where: { model: prefix + "model" } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, actor, peer, foreign] } } });
  await prisma.group.deleteMany({ where: { id: groupId } });
});
describe("resource-scoped own channel submission reads", () => {
  it("preserves private/disabled own submissions, review status, capability projection and credential-presence flags", async () => {
    const result = await list();
    expect(result).toMatchObject({ total: 3, page: 1, pageSize: 20 });
    expect(result.items.map((row) => row.id)).toEqual(ids);
    expect(result.items.map((row) => row.submissionStatus)).toEqual(["pending", "rejected", "approved"]);
    expect(result.items[0]).toMatchObject({
      openaiUpstreamUrl: "https://fixture.invalid/3",
      hasOpenaiUpstreamApiKey: true,
      hasAnthropicUpstreamApiKey: false,
      hasGeminiUpstreamApiKey: true,
      allowedModels: [prefix + "model"],
      visibilityMode: "private",
      enabled: false,
    });
    expect(JSON.stringify(result)).not.toContain("fixture-secret-key");
    expect(result.items.every((row) => row.poolMembers?.length === 0 && !row.pooledParentId)).toBe(true);
  });
  it("filters before both pagination and totals, without loading denied/off-page configuration", async () => {
    await grant(relayChannelSubmissionArn(owner, actor, ids[0]!));
    const { reads, presence } = interceptReads();
    const result = await list(1, 1);
    expect(result.items.map((row) => row.id)).toEqual([ids[1]]);
    expect(result.total).toBe(2);
    for (const read of reads.filter((read) => read.select?.name)) expect(read.where?.id).toEqual({ in: [ids[1]] });
    for (const call of presence) expect(call.ids).toEqual([ids[1]]);
    expect((await list(2, 1)).items.map((row) => row.id)).toEqual([ids[2]]);
  });
  it("does not hydrate any payload, catalog or credential flag when all resources are denied", async () => {
    await grant("*");
    const { reads, presence } = interceptReads();
    const pricing = vi.spyOn(prisma.modelPricing, "findMany");
    expect(await list()).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(reads.every((read) => !read.select?.name)).toBe(true);
    expect(presence.every((call) => call.ids.length === 0)).toBe(true);
    expect(pricing).not.toHaveBeenCalled();
  });
  it("cannot list another submitter's data even with a wildcard policy or trusted account context", async () => {
    await grant("*", "Allow");
    const result = await list();
    expect(result.items.map((row) => row.id)).toEqual(ids);
    const { reads, presence } = interceptReads();
    await list();
    expect(reads.every((read) => read.where?.submittedByUserId === actor)).toBe(true);
    expect(presence.every((call) => call.ids.every((id) => ids.includes(String(id))))).toBe(true);
    const req = request();
    req.user!.userId = owner;
    req.authContext!.principalUserId = owner;
    await expect(list(1, 20, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("supports JSON-only scoped grants without granting platform eligibility or requiring legacy SUBMIT", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    await grant(relayChannelSubmissionArn(owner, actor, ids[1]!), "Allow");
    const result = await list();
    expect(result.total).toBe(1);
    expect(result.items.map((row) => row.id)).toEqual([ids[1]]);
  });
  it("default-denies when no legacy or JSON grant exists", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [] } });
    expect(await list()).toMatchObject({ total: 0, items: [] });
  });
  it.each(["missing", "foreign", "oauth", "actor"])("rejects %s request bindings", async (kind) => {
    const req = request();
    if (kind === "missing") delete req.authContext;
    if (kind === "foreign") req.authContext!.accountOwnerId = foreign;
    if (kind === "actor") req.user!.userId = peer;
    if (kind === "oauth") req.oauthAccessToken = { id: "fixture", userId: actor } as TypedRequest["oauthAccessToken"];
    await expect(list(1, 20, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    { page: 0, pageSize: 20 },
    { page: 1, pageSize: 101 },
    { page: 1.5, pageSize: 20 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 20 },
  ])("rejects unsafe pagination $page/$pageSize", async ({ page, pageSize }) => {
    await expect(list(page, pageSize)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("returns an empty out-of-range page but keeps the authorized total", async () => {
    expect(await list(10, 1)).toEqual({ total: 3, items: [], page: 10, pageSize: 1 });
  });
  it("reads credentials as SQL booleans only, never rich records, pricing rates or user secrets", async () => {
    const { reads, presence } = interceptReads();
    const rich = vi.spyOn(RelayChannelRepository.getInstance(), "listSubmittedByUser");
    await list();
    expect(rich).not.toHaveBeenCalled();
    expect(presence.length).toBeGreaterThan(0);
    for (const call of presence) {
      expect(call.ids.every((id) => ids.includes(id))).toBe(true);
      expect(JSON.stringify(call.flags)).not.toContain("fixture-secret-key");
    }
    for (const read of reads) {
      expect(read.select).toBeTruthy();
      expect(read.include).toBeUndefined();
      for (const name of ["openaiUpstreamApiKey", "anthropicUpstreamApiKey", "geminiUpstreamApiKey"])
        expect(read.select).not.toHaveProperty(name);
      expect(read.select?.submittedBy).toEqual(read.select?.submittedBy ? { select: { username: true } } : undefined);
    }
  });
  it.each(["request", "decision", "key", "session", "owner", "mode"])(
    "rejects changed %s authority before returning data",
    async (kind) => {
      const req = request();
      let sessionId: string | undefined;
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-" + randomUUID() } });
        req.authContext!.subjectType = "access_key";
        req.accessKey = { id: key.id } as TypedRequest["accessKey"];
      }
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
        await grant("*", "Allow", { type: "role", id: role.id });
      }
      let changed = false;
      interceptReads((tx) => {
        const resolver = RelayPoolResolverService.getInstance(),
          resolve = resolver.resolveChannelCapabilities.bind(resolver);
        vi.spyOn(resolver, "resolveChannelCapabilities").mockImplementation(async (...args) => {
          const result = await resolve(...args);
          if (!changed) {
            changed = true;
            if (kind === "request") req.authContext!.accountOwnerId = foreign;
            else if (kind === "mode") env.security.iamAuthorizationMode = "legacy";
            else if (kind === "decision")
              vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
                input.resources.map(() => ({
                  decision: "ExplicitDeny",
                  reason: "explicit-deny",
                  matchedStatements: [],
                })),
              );
            else if (kind === "key")
              await prisma.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
            else if (kind === "session")
              await tx.ramRoleSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
            else await tx.user.update({ where: { id: owner }, data: { status: 0 } });
          }
          return result;
        });
      });
      const failure = await list(1, 20, req).then(
        () => undefined,
        (error) => error as Error & { statusCode?: number },
      );
      expect(changed, failure?.stack).toBe(true);
      expect(failure).toMatchObject({ statusCode: 403 });
    },
  );
  it.each(["payload", "ownership", "credential-presence"])(
    "rejects changed %s with preserved update timestamps",
    async (kind) => {
      const req = request();
      let changed = false;
      interceptReads((tx) => {
        const resolver = RelayPoolResolverService.getInstance(),
          resolve = resolver.resolveChannelCapabilities.bind(resolver);
        vi.spyOn(resolver, "resolveChannelCapabilities").mockImplementation(async (...args) => {
          const result = await resolve(...args);
          if (!changed) {
            changed = true;
            const row = await tx.relayChannel.findUniqueOrThrow({
              where: { id: ids[0] },
              select: { updateTime: true },
            });
            await tx.relayChannel.update({
              where: { id: ids[0] },
              data: {
                updateTime: row.updateTime,
                ...(kind === "payload"
                  ? { name: "changed" }
                  : kind === "ownership"
                    ? { submittedByUserId: peer }
                    : { openaiUpstreamApiKey: "" }),
              },
            });
          }
          return result;
        });
      });
      const failure = await list(1, 20, req).then(
        () => undefined,
        (error) => error as Error & { statusCode?: number },
      );
      expect(changed, failure?.stack).toBe(true);
      expect(failure).toMatchObject({ statusCode: 403 });
    },
  );
  it("uses role-only submission scopes rather than inheriting the user's legacy grants", async () => {
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: prefix } }),
      session = await prisma.ramRoleSession.create({
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
    expect(await list(1, 20, req)).toMatchObject({ total: 0, items: [] });
    await grant(relayChannelSubmissionArn(owner, actor, ids[0]!), "Allow", { type: "role", id: role.id });
    expect((await list(1, 20, req)).items.map((row) => row.id)).toEqual([ids[0]]);
  });
  it.each(["legacy", "shadow"] as const)(
    "%s performs one old payload read with no second configuration or credential read",
    async (authorizationMode) => {
      env.security.iamAuthorizationMode = authorizationMode;
      const old = vi.spyOn(RelayChannelRepository.getInstance(), "listSubmittedByUser");
      const { reads, presence } = interceptReads();
      expect((await list()).total).toBe(3);
      expect(old).toHaveBeenCalledOnce();
      expect(presence.every((call) => call.ids.length === 0)).toBe(true);
      expect(reads.every((read) => !read.select?.name)).toBe(true);
    },
  );
});
