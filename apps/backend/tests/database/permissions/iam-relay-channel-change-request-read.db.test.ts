import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { RelayChannelChangeRequestRepository } from "@/store/relay/relay-channel-change-request.repository";
import {
  RelayChannelChangeRequestReadRepository,
  relayChannelChangeRequestPublicSelect,
} from "@/store/relay/relay-channel-change-request-read.repository";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  relayChannelChangeRequestArn,
  platformRelayChannelChangeRequestArn,
} from "@/iam/resources/relay-channel-change-request-resources";
import type { TypedRequest } from "@/types/express";
const service = RelayChannelService.getInstance(),
  originalMode = env.security.iamAuthorizationMode;
let owner: string, actor: string, peer: string, foreign: string, groupId: string, channel: string, otherChannel: string;
let ids: string[], peerId: string, foreignId: string, prefix: string;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    ip: "127.0.0.1",
    secure: true,
  }) as unknown as TypedRequest;
const mineAction = "quyan:relay:ListMyChannelChangeRequests",
  adminAction = "quyan:relay:ListChannelChangeRequests";
const mineArn = (id: string, user = actor) => relayChannelChangeRequestArn(owner, user, id);
const adminArn = (id: string, channelId = channel) => platformRelayChannelChangeRequestArn(channelId, id);
const mine = (page = 1, pageSize = 20, req = request()) => service.listMyChangeRequests(actor, page, pageSize, req);
const admin = (page = 1, pageSize = 20, status?: "pending" | "approved" | "rejected", req = request()) =>
  service.listChangeRequests(page, pageSize, status, req);
async function grant(
  action: string,
  resource: string,
  effect: "Allow" | "Deny" = "Deny",
  principal = { type: "user", id: actor },
) {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Effect: effect, Action: action, Resource: resource } });
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
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  prefix = "iam-change-read-" + randomUUID();
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
      data: {
        username: prefix,
        name: prefix,
        accountOwnerId: null,
        permissions: [Permission.RELAY_CHANNEL_SUBMIT, Permission.RELAY_CHANNEL_REVIEW],
      },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId } });
  channel = (await prisma.relayChannel.create({ data: { name: prefix, submittedByUserId: actor } })).id;
  otherChannel = (await prisma.relayChannel.create({ data: { name: prefix + "-other", submittedByUserId: foreign } }))
    .id;
  const create = async (submittedByUserId: string, n: number, relayChannelId = channel) =>
    (
      await prisma.relayChannelChangeRequest.create({
        data: {
          submittedByUserId,
          relayChannelId,
          encryptedCredentials: "fixture-ciphertext",
          credentialIv: "fixture-iv",
          credentialAuthTag: "fixture-tag",
          configSnapshot: {
            name: prefix + "-" + n,
            openaiUpstreamUrl: "https://example.invalid/v1",
            multiplier: 1.2,
            allowedModels: '["model-a"]',
            modelMapping: { "model-a": "model-b" },
            providers: [
              {
                username: "fixture-provider",
                commissionPercent: 20,
                settlementMode: "realtime",
                secret: "fixture-nested-secret",
              },
            ],
            hasOpenaiUpstreamApiKey: true,
            previousChannelStatus: 1,
            previousSubmissionStatus: "approved",
            openaiUpstreamApiKey: "fixture-snapshot-secret",
            unexpectedSecret: "fixture-unknown-secret",
          },
          createTime: new Date(Date.UTC(2026, 9, 16, 0, 0, n)),
        },
      })
    ).id;
  ids = [await create(actor, 3), await create(actor, 2), await create(actor, 1)];
  peerId = await create(peer, 4);
  foreignId = await create(foreign, 5, otherChannel);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.relayChannel.deleteMany({ where: { id: { in: [channel, otherChannel] } } });
  await prisma.ramRoleSession.deleteMany({ where: { accountOwnerId: owner } });
  env.security.iamAuthorizationMode = originalMode;
});
describe("resource-scoped channel change request lists", () => {
  it("filters own rows before pagination and totals, ignoring forged action metadata", async () => {
    await grant(mineAction, mineArn(ids[0]!));
    const old = vi.spyOn(RelayChannelChangeRequestRepository.getInstance(), "listMine");
    expect(await mine(1, 1)).toMatchObject({ total: 2, page: 1, pageSize: 1, items: [{ id: ids[1] }] });
    expect(await mine(2, 1)).toMatchObject({ total: 2, items: [{ id: ids[2] }] });
    expect(old).not.toHaveBeenCalled();
  });
  it("never exposes peer or foreign requests, even when explicitly granted wildcard personal access", async () => {
    await grant(mineAction, "*", "Allow");
    const result = await mine();
    expect(result.total).toBe(3);
    expect(result.items.map((row) => row.id).sort()).toEqual([...ids].sort());
    expect(result.items.map((row) => row.id)).not.toContain(peerId);
    expect(result.items.map((row) => row.id)).not.toContain(foreignId);
  });
  it("supports JSON-only exact grants without legacy submit permissions", async () => {
    await prisma.user.update({ where: { id: actor }, data: { groupId: null } });
    await grant(mineAction, mineArn(ids[1]!), "Allow");
    expect(await mine()).toMatchObject({ total: 1, items: [{ id: ids[1] }] });
  });
  it("requires native Allow and gives explicit Deny priority", async () => {
    await prisma.user.update({ where: { id: actor }, data: { groupId: null } });
    expect(await mine()).toMatchObject({ total: 0, items: [] });
    await grant(mineAction, mineArn(ids[0]!), "Allow");
    await grant(mineAction, mineArn(ids[0]!));
    expect(await mine()).toMatchObject({ total: 0, items: [] });
  });
  it("reviews deployment resources across submitter accounts but filters each request and status", async () => {
    await grant(adminAction, adminArn(ids[0]!));
    await prisma.relayChannelChangeRequest.update({ where: { id: peerId }, data: { reviewStatus: "approved" } });
    expect(await admin(1, 1, "approved")).toMatchObject({
      total: 1,
      items: [{ id: peerId, reviewStatus: "approved" }],
    });
    const result = await admin();
    expect(result.total).toBe(4);
    expect(result.items[0]!.id).toBe(foreignId);
  });
  it.each(["account-group", "no-group", "disabled-group"] as const)(
    "does not let IAM policies manufacture reviewer qualification: %s",
    async (kind) => {
      await grant(adminAction, "*", "Allow");
      if (kind === "account-group")
        await prisma.group.update({ where: { id: groupId }, data: { accountOwnerId: owner } });
      if (kind === "no-group")
        await prisma.user.update({
          where: { id: actor },
          data: { groupId: null, permissionAdds: [Permission.RELAY_CHANNEL_REVIEW] },
        });
      if (kind === "disabled-group") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
      await expect(admin()).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("uses distinct personal and deployment action/resources", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { permissions: [Permission.RELAY_CHANNEL_SUBMIT] } });
    await grant(mineAction, mineArn(ids[0]!), "Allow");
    await expect(admin()).rejects.toMatchObject({ statusCode: 403 });
    expect(await mine()).toMatchObject({ total: 3 });
  });
  it("does not hydrate encrypted credentials or denied config and strips unknown snapshot fields", async () => {
    await grant(mineAction, mineArn(ids[0]!));
    const original = prisma.$transaction.bind(prisma),
      reads: Prisma.RelayChannelChangeRequestFindManyArgs[] = [];
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      original(async (tx) => {
        const find = tx.relayChannelChangeRequest.findMany.bind(tx.relayChannelChangeRequest);
        vi.spyOn(tx.relayChannelChangeRequest, "findMany").mockImplementation((args) => {
          if (args) reads.push(args);
          return find(args);
        });
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    const result = await mine(),
      json = JSON.stringify(result);
    expect(result.items[0]!.config).toMatchObject({
      name: prefix + "-2",
      hasOpenaiUpstreamApiKey: true,
      multiplier: 1.2,
      providers: [{ username: "fixture-provider", commissionPercent: 20, settlementMode: "realtime" }],
    });
    for (const value of [
      "fixture-ciphertext",
      "fixture-iv",
      "fixture-tag",
      "fixture-snapshot-secret",
      "fixture-nested-secret",
      "fixture-unknown-secret",
      "previousChannelStatus",
    ])
      expect(json).not.toContain(value);
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.include).toBeUndefined();
      expect(read.select).toBeDefined();
      expect(read.select).not.toHaveProperty("encryptedCredentials");
      expect(read.select).not.toHaveProperty("credentialIv");
      expect(read.select).not.toHaveProperty("credentialAuthTag");
    }
    for (const read of reads.filter((row) => row.select?.configSnapshot))
      expect(JSON.stringify(read.where)).not.toContain(ids[0]);
    expect(relayChannelChangeRequestPublicSelect).not.toHaveProperty("encryptedCredentials");
  });
  it.each(["personal", "platform"] as const)(
    "excludes deleted requests and nonvisible channels for %s",
    async (kind) => {
      await prisma.relayChannelChangeRequest.update({ where: { id: ids[0] }, data: { status: -1 } });
      await prisma.relayChannel.update({ where: { id: otherChannel }, data: { status: -1 } });
      const result = kind === "personal" ? await mine() : await admin();
      expect(result.total).toBe(kind === "personal" ? 2 : 3);
    },
  );
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])(
    "rejects invalid pages without reading configurations: %s",
    async (page) => {
      await expect(mine(page, 20)).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it.each([0, -1, 101, 1.5])("rejects invalid page size: %s", async (size) => {
    await expect(mine(1, size)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed for missing, mismatched, OAuth and disabled identity contexts", async () => {
    await expect(service.listMyChangeRequests(actor)).rejects.toMatchObject({ statusCode: 403 });
    const req = request();
    req.user!.userId = peer;
    await expect(mine(1, 20, req)).rejects.toMatchObject({ statusCode: 403 });
    const oauth = request();
    oauth.oauthAccessToken = { id: "fixture" } as NonNullable<TypedRequest["oauthAccessToken"]>;
    await expect(mine(1, 20, oauth)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    await expect(mine()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not return data when policy decisions change after scan", async () => {
    const iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    let count = 0;
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await authorize(input);
      return ++count > 1 ? result.map((row) => ({ ...row, decision: "ExplicitDeny" as const })) : result;
    });
    await expect(mine()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not hydrate configs after a prehydration principal mutation", async () => {
    const req = request(),
      iam = IamAuthorizationService.getInstance(),
      authorize = iam.authorizeMany.bind(iam);
    vi.spyOn(iam, "authorizeMany").mockImplementation(async (input) => {
      const result = await authorize(input);
      req.authContext!.principalUserId = peer;
      return result;
    });
    await expect(mine(1, 20, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks the full public projection even when parent timestamps remain unchanged", async () => {
    const original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: object,
    ) =>
      original(async (tx) => {
        const find = tx.relayChannelChangeRequest.findMany.bind(tx.relayChannelChangeRequest);
        let hydrated = false;
        vi.spyOn(tx.relayChannelChangeRequest, "findMany").mockImplementation((async (
          args?: Prisma.RelayChannelChangeRequestFindManyArgs,
        ) => {
          const result = await find(args);
          if (args?.select?.configSnapshot && !hydrated) {
            hydrated = true;
            await tx.$executeRaw`UPDATE relay_channel_change_requests SET configSnapshot = ${JSON.stringify({ name: "changed" })} WHERE id = ${ids[0]}`;
          }
          return result;
        }) as typeof tx.relayChannelChangeRequest.findMany);
        return callback(tx);
      }, options)) as typeof prisma.$transaction);
    await expect(mine()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses role-only policies and rejects revoked role sessions", async () => {
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
    expect(await mine(1, 20, req)).toMatchObject({ total: 0 });
    await grant(mineAction, mineArn(ids[1]!), "Allow", { type: "role", id: role.id });
    expect(await mine(1, 20, req)).toMatchObject({ total: 1, items: [{ id: ids[1] }] });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(mine(1, 20, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("executes the legacy read exactly once in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    await grant(mineAction, mineArn(ids[0]!));
    const legacy = vi.spyOn(RelayChannelChangeRequestRepository.getInstance(), "listMine");
    expect(await mine()).toMatchObject({ total: 3 });
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("denies legacy access without historical permission, even with IAM Allow", async () => {
    env.security.iamAuthorizationMode = "legacy";
    await prisma.user.update({ where: { id: actor }, data: { groupId: null } });
    await grant(mineAction, mineArn(ids[0]!), "Allow");
    await expect(mine()).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["policy", "identity", "qualification", "key"] as const)(
    "rejects late %s revocation after repository projection",
    async (kind) => {
      const repository = RelayChannelChangeRequestReadRepository.getInstance(),
        read = repository.list.bind(repository),
        req = request();
      if (kind === "key") {
        const key = await prisma.accessKey.create({ data: { userId: actor, key: "fixture-only-" + randomUUID() } });
        req.accessKey = { id: key.id } as NonNullable<TypedRequest["accessKey"]>;
        req.authContext!.subjectType = "access_key";
      }
      vi.spyOn(repository, "list").mockImplementation(async (...args) => {
        const result = await read(...args);
        if (kind === "policy") await grant(mineAction, mineArn(ids[0]!));
        if (kind === "identity") await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
        if (kind === "qualification") await prisma.group.update({ where: { id: groupId }, data: { status: 0 } });
        if (kind === "key") await prisma.accessKey.update({ where: { id: req.accessKey!.id }, data: { status: 0 } });
        return result;
      });
      await expect(kind === "qualification" ? admin(1, 20, undefined, req) : mine(1, 20, req)).rejects.toMatchObject({
        statusCode: 403,
      });
    },
  );
  it("keeps shadow authorization metadata-only before the single legacy projection", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const repository = RelayChannelChangeRequestReadRepository.getInstance(),
      read = repository.list.bind(repository);
    const native = vi.spyOn(repository, "list").mockImplementation(async (...args) => {
      const result = await read(...args);
      expect(result.items).toEqual([]);
      return result;
    });
    const legacy = vi.spyOn(RelayChannelChangeRequestRepository.getInstance(), "listMine");
    expect(await mine()).toMatchObject({ total: 3 });
    expect(native).toHaveBeenCalledTimes(1);
    expect(native.mock.calls[0]![4]).toBe(false);
    expect(legacy).toHaveBeenCalledTimes(1);
  });
  it("rejects an unknown review filter without native projection", async () => {
    await expect(admin(1, 20, "unknown" as "pending")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed for an unknown rollout mode", async () => {
    env.security.iamAuthorizationMode = "invalid" as typeof env.security.iamAuthorizationMode;
    await expect(mine()).rejects.toMatchObject({ statusCode: 403 });
  });
});
