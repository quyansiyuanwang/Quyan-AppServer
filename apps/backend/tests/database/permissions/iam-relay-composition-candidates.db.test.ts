import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { RelayTokenService } from "@/services/relay/relay-token.service";
import { RelayTokenCompositionReadRepository } from "@/store/relay/relay-token-composition-read.repository";
import { RelayCompositionRepository } from "@/store/relay/relay-composition.repository";
import { RelayTokenRepository } from "@/store/relay/relay-token.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import type { TypedRequest } from "@/types/express";
const oldMode = env.security.iamAuthorizationMode,
  action = "quyan:relay:ListTokenCompositionCandidates",
  managedAction = "quyan:relay:ListManagedTokenCompositionCandidates";
let owner: string,
  actor: string,
  peer: string,
  group: string,
  parent: string,
  child: string,
  other: string,
  peerToken: string,
  prefix: string;
const repo = () => RelayTokenCompositionReadRepository.getInstance();
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "fake:*" },
    secure: true,
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const read = (
  query: {
    page?: number;
    pageSize?: number;
    search?: string;
    editingTokenId?: string;
    selectedIds?: string;
    targetUserId?: string;
  } = {},
  req = request(),
) =>
  new RelayTokenService().compositionCandidates(
    actor,
    query.page,
    query.pageSize,
    query.search,
    query.editingTokenId,
    query.selectedIds,
    query.targetUserId,
    req,
  );
async function grant(Action: string, Resource: string, Effect: "Allow" | "Deny" = "Deny") {
  const parsed = parseIamPolicy({ Version: "1", Statement: { Action, Resource, Effect } }),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: prefix + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: policy.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
beforeEach(async () => {
  env.security.iamAuthorizationMode = "enforce";
  prefix = "candidate-iam-" + randomUUID();
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
  group = (
    await prisma.group.create({
      data: { name: prefix, username: prefix, accountOwnerId: null, permissions: [Permission.RELAY_TOKEN_READ] },
    })
  ).id;
  await prisma.user.update({ where: { id: actor }, data: { groupId: group } });
  const token = async (userId: string, name: string, routingMode = "ordered") =>
    (
      await prisma.relayToken.create({
        data: {
          userId,
          name,
          routingMode,
          token: "sk-rlt-fixture-" + randomUUID(),
          upstreamApiKey: "fixture-composition-secret",
          createTime: new Date("2026-10-16T00:00:00Z"),
        },
      })
    ).id;
  parent = await token(actor, "parent", "composite");
  child = await token(actor, "child");
  other = await token(actor, "other");
  peerToken = await token(peer, "peer");
  await prisma.relayTokenMemberConfig.create({
    data: { parentTokenId: parent, tokenId: child, priority: 0, enabled: true },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = oldMode;
  await prisma.ramAuthorization.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.ramPolicy.deleteMany({ where: { accountOwnerId: owner } });
  await prisma.relayTokenMemberConfig.deleteMany({ where: { parentToken: { userId: { in: [actor, peer] } } } });
  await prisma.relayToken.deleteMany({ where: { userId: { in: [actor, peer] } } });
  await prisma.accessKey.deleteMany({ where: { userId: actor } });
  await prisma.oAuthAccessToken.deleteMany({ where: { userId: actor } });
  await prisma.oAuthClient.deleteMany({ where: { userId: actor } });
  await prisma.user.deleteMany({ where: { id: { in: [actor, peer, owner] } } });
  await prisma.group.deleteMany({ where: { id: group } });
});
describe("resource-authorized composition candidate graph", () => {
  it("returns authorized graph members without loading credential or routing columns", async () => {
    const rich = vi.spyOn(RelayTokenRepository.getInstance(), "findByIdWithRelations"),
      queries = vi.spyOn(prisma.relayToken, "findMany");
    const result = await read();
    expect(result.total).toBe(3);
    expect(result.items.find((row) => row.id === parent)).toMatchObject({
      memberCount: 1,
      memberTokenConfigs: [{ tokenId: child, priority: 0, enabled: true }],
    });
    expect(JSON.stringify(result)).not.toMatch(/fixture-composition-secret|upstream|channelId|updateTime/);
    expect(rich).not.toHaveBeenCalled();
    for (const [query] of queries.mock.calls) {
      expect(query!.select).toBeDefined();
      expect(query!.select).not.toHaveProperty("token");
      expect(query!.select).not.toHaveProperty("upstreamApiKey");
      expect(query!.select).not.toHaveProperty("channel");
    }
  });
  it("filters a denied member and every revealing ancestor before totals and pages", async () => {
    await grant(action, relayTokenArn(owner, actor, child));
    const result = await read({ pageSize: 1 });
    expect(result).toMatchObject({ total: 1, items: [{ id: other }] });
    expect(JSON.stringify(result)).not.toContain(child);
    expect(JSON.stringify(result)).not.toContain(parent);
  });
  it("does not load topology rows for denied tokens", async () => {
    await grant(action, relayTokenArn(owner, actor, child));
    const graph = vi.spyOn(repo(), "graph");
    await read();
    expect(graph.mock.calls.every(([, targets]) => targets.every((row) => row.id !== child))).toBe(true);
    await grant(action, "*");
    graph.mockClear();
    expect(await read()).toMatchObject({ total: 0, items: [] });
    expect(graph.mock.calls.every(([, targets]) => targets.length === 0)).toBe(true);
  });
  it("does not disclose a denied disabled member through counts or topology", async () => {
    await prisma.relayTokenMemberConfig.updateMany({ where: { parentTokenId: parent }, data: { enabled: false } });
    await grant(action, relayTokenArn(owner, actor, child));
    expect(await read()).toMatchObject({ total: 1, items: [{ id: other }] });
  });
  it("allows exact JSON-only candidate grants without GetToken or Reveal", async () => {
    await prisma.group.update({ where: { id: group }, data: { permissions: [] } });
    await grant(action, relayTokenArn(owner, actor, other), "Allow");
    await grant("quyan:relay:GetToken", "*");
    await grant("quyan:relay:RevealToken", "*");
    expect(await read()).toMatchObject({ total: 1, items: [{ id: other }] });
  });
  it("fails explicitly selected or edited denied tokens closed", async () => {
    await grant(action, relayTokenArn(owner, actor, child));
    for (const query of [{ selectedIds: child }, { selectedIds: parent }, { editingTokenId: child }])
      await expect(read(query)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("preserves cycle indicators only for completely authorized ancestors", async () => {
    const result = await read({ editingTokenId: child });
    expect(result.items.find((row) => row.id === child)).toMatchObject({
      selectable: false,
      unavailableReason: "self",
    });
    expect(result.items.find((row) => row.id === parent)).toMatchObject({
      selectable: false,
      unavailableReason: "cycle",
    });
  });
  it("keeps disabled/expired nodes available for inspection but does not expose deleted descendants", async () => {
    await prisma.relayToken.update({ where: { id: child }, data: { status: 0, expiresAt: new Date(0) } });
    expect((await read()).total).toBe(3);
    await prisma.relayToken.update({ where: { id: child }, data: { status: -1 } });
    expect(await read()).toMatchObject({ total: 1, items: [{ id: other }] });
  });
  it("does not traverse or disclose a cross-owner member edge", async () => {
    await prisma.relayTokenMemberConfig.updateMany({ where: { parentTokenId: parent }, data: { tokenId: peerToken } });
    const result = await read();
    expect(result.total).toBe(2);
    expect(result.items.map((row) => row.id)).not.toContain(parent);
    expect(JSON.stringify(result)).not.toContain(peerToken);
  });
  it("honors case-insensitive name search and pinned selection only within the authorized graph", async () => {
    expect(await read({ search: "PARENT" })).toMatchObject({ total: 1, items: [{ id: parent }] });
    expect((await read({ search: "PARENT", selectedIds: other })).total).toBe(2);
  });
  it("does not infer peer-management qualification from account grants", async () => {
    await grant(managedAction, "*", "Allow");
    await expect(read({ targetUserId: peer })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires personal, platform-user and per-token managed admission for same-account peers", async () => {
    await prisma.group.update({
      where: { id: group },
      data: { permissions: [Permission.RELAY_TOKEN_READ, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] },
    });
    expect(await read({ targetUserId: peer })).toMatchObject({ total: 1, items: [{ id: peerToken }] });
    await grant(managedAction, platformRelayTokenArn(peer, peerToken));
    expect(await read({ targetUserId: peer })).toMatchObject({ total: 0, items: [] });
  });
  it.each(["personal", "user"])("rejects denied %s admission for managed candidates", async (kind) => {
    await prisma.group.update({
      where: { id: group },
      data: { permissions: [Permission.RELAY_TOKEN_READ, Permission.RELAY_TOKEN_MANAGE_OTHERS_READ] },
    });
    await grant(kind === "personal" ? action : managedAction, kind === "personal" ? "*" : platformUserArn(peer));
    await expect(read({ targetUserId: peer })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks graph edges and topology before release", async () => {
    const original = repo().graph.bind(repo());
    let changed = false;
    vi.spyOn(repo(), "graph").mockImplementation(async (...args) => {
      const rows = await original(...args);
      if (!changed) {
        changed = true;
        await prisma.relayTokenMemberConfig.updateMany({ where: { parentTokenId: parent }, data: { enabled: false } });
      }
      return rows;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks every contributing token decision after graph projection", async () => {
    const original = repo().graph.bind(repo());
    vi.spyOn(repo(), "graph").mockImplementation(async (...args) => {
      const rows = await original(...args);
      vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany").mockImplementation(async (input) =>
        input.resources.map(() => ({ decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] })),
      );
      return rows;
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks request binding during graph reads", async () => {
    const req = request(),
      original = repo().graph.bind(repo());
    vi.spyOn(repo(), "graph").mockImplementation(async (...args) => {
      const rows = await original(...args);
      req.authContext!.accountOwnerId = peer;
      return rows;
    });
    await expect(read({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("scans owner topology and evaluates authorization beyond 500 tokens", async () => {
    await prisma.relayToken.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({
        userId: actor,
        name: "extra" + i,
        token: "fixture-" + randomUUID(),
      })),
    });
    const authorize = vi.spyOn(IamAuthorizationService.getInstance(), "authorizeMany");
    expect(await read({ pageSize: 100 })).toMatchObject({ total: 504, items: expect.any(Array) });
    expect(Math.max(...authorize.mock.calls.map(([input]) => input.resources.length))).toBeLessThanOrEqual(500);
  });
  it("shadow never loads the native graph and invokes legacy candidates once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    const graph = vi.spyOn(repo(), "graph"),
      legacy = vi.spyOn(RelayCompositionRepository.getInstance(), "candidates");
    expect((await read()).total).toBe(3);
    expect(graph).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledTimes(1);
  });
});
