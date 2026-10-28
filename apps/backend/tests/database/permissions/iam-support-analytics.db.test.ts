import { IamAccountUserCollectionService } from "@/services/users/iam-account-user-collection.service";
import { SupportAiUsageRepository } from "@/store/support/support-ai-usage.repository";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { onlineUserArn } from "@/iam/resources/online-session-resources";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, peer: string, foreign: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "support-analytics-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  peer = await user(owner);
  foreign = await user();
});
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "support-analytics-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
  return prisma.ramAuthorization.create({
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
const action = "quyan:support:GetUserUsageAnalytics",
  service = IamAccountUserCollectionService.getInstance(),
  repository = SupportAiUsageRepository.getInstance();
const usage = (userId = peer, totalTokens = 10, status = 1, createTime = new Date()) =>
  prisma.supportAiUsageRecord.create({
    data: {
      userId,
      model: "fixture",
      inputTokens: totalTokens - 2,
      outputTokens: 2,
      totalTokens,
      estimatedCost: 0.25,
      status,
      createTime,
    },
  });
const grant = (id = peer) =>
  bind({ Version: "1", Statement: { Effect: "Allow", Action: action, Resource: onlineUserArn(owner, id) } });
const read = (query = {}) =>
  service.read(action, request(), (ids, principal) => repository.getAccountAnalytics(principal, query, ids));
describe("resource-filtered support analytics", () => {
  it("aggregates counts, cost, trends and user pages from authorized account users only", async () => {
    await usage();
    await usage();
    await usage(actor, 100);
    await usage(foreign, 500);
    await usage(peer, 1000, 0);
    await grant();
    const result = await read();
    expect(result.totalRequests).toBe(2);
    expect(result.totalTokens).toBe(20);
    expect(result.totalEstimatedCost).toBe(0.5);
    expect(result.totalUsers).toBe(1);
    expect(result.users.map((u) => u.userId)).toEqual([peer]);
    expect(result.trends.reduce((n, t) => n + t.totalTokens, 0)).toBe(20);
  });
  it("wildcard Allow remains account-limited and Deny excludes the full user aggregate", async () => {
    await usage(peer, 10);
    await usage(actor, 50);
    await usage(foreign, 500);
    await bind({
      Version: "1",
      Statement: [
        { Effect: "Allow", Action: action, Resource: "*" },
        { Effect: "Deny", Action: action, Resource: onlineUserArn(owner, actor) },
      ],
    });
    const result = await read();
    expect(result.totalTokens).toBe(10);
    expect(result.users.map((u) => u.userId)).toEqual([peer]);
  });
  it("returns zero totals for an empty authorized set instead of falling back to a global query", async () => {
    await usage();
    await usage(foreign, 500);
    const result = await read();
    expect(result.totalRequests).toBe(0);
    expect(result.totalUsers).toBe(0);
    expect(result.trends).toEqual([]);
  });
  it("validates a selected user resource and refuses foreign target IDs", async () => {
    await usage();
    await grant();
    const query = { userId: peer };
    expect(
      (await service.read(action, request(), (ids, p) => repository.getAccountAnalytics(p, query, ids), peer))
        .totalRequests,
    ).toBe(1);
    await expect(
      service.read(action, request(), (ids, p) => repository.getAccountAnalytics(p, { userId: foreign }, ids), foreign),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("discards already computed aggregates if permissions or user revisions change", async () => {
    await usage();
    const binding = await grant();
    await expect(
      service.read(action, request(), async (ids, p) => {
        const result = await repository.getAccountAnalytics(p, {}, ids);
        await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
        return result;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: 1 } });
    await expect(
      service.read(action, request(), async (ids, p) => {
        const result = await repository.getAccountAnalytics(p, {}, ids);
        await prisma.user.update({ where: { id: peer }, data: { updateTime: new Date(Date.now() + 2000) } });
        return result;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("paginates users after authorization and preserves bounded analytics windows", async () => {
    await usage(peer, 10);
    await usage(actor, 20);
    await usage(peer, 100, 1, new Date(Date.now() - 100 * 86400000));
    await grant(peer);
    await grant(actor);
    const result = await read({ page: 2, pageSize: 1, startAt: new Date(Date.now() - 365 * 86400000).toISOString() });
    expect(result.totalUsers).toBe(2);
    expect(result.totalTokens).toBe(30);
    expect(result.users.map((u) => u.userId)).toEqual([peer]);
  });
});
