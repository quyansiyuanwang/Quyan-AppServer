import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { PlatformOAuthReviewIamService } from "@/services/users/platform-oauth-review-iam.service";
import { platformOAuthReviewClientArn } from "@/iam/resources/platform-oauth-resources";
import { Permission } from "@quyan/shared";
import { PlatformOAuthReviewRepository } from "@/store/users/platform-oauth-review.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, foreign: string, visible: string, hidden: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "oauth-read-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const client = async (userId: string, isSystemClient = false) =>
  (
    await prisma.oAuthClient.create({
      data: {
        userId,
        name: "fixture",
        clientId: "fixture-" + randomUUID(),
        clientSecretHash: "fixture-hash-never-selected",
        clientSecretPreview: "fixture-mask",
        grantTypes: ["authorization_code"],
        scopes: ["oauth_client"],
        redirectUris: [],
        isSystemClient,
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
const service = PlatformOAuthReviewIamService.getInstance(),
  repository = PlatformOAuthReviewRepository.getInstance();
beforeEach(async () => {
  vi.restoreAllMocks();
  // This file uses global review resources; remove only fixtures from earlier tests in its isolated worker database.
  await prisma.oAuthClient.updateMany({
    where: { clientId: { startsWith: "fixture-" } },
    data: { status: -1 },
  });
  owner = await user();
  actor = await user(owner);
  foreign = await user();
  visible = await client(foreign);
  hidden = await client(foreign);
});
async function globalGroup(permissions = [Permission.OAUTH_CLIENT_REVIEW_READ]) {
  const group = await prisma.group.create({
    data: { username: "platform-" + randomUUID(), name: "fixture global", level: 0, permissions, accountOwnerId: null },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: group.id } });
  return group;
}
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "platform-" + randomUUID(),
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
describe("platform OAuth review read database", () => {
  it("filters unauthorized applications before pagination and total", async () => {
    await globalGroup();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:oauth:ListClientReviews",
        Resource: platformOAuthReviewClientArn(hidden),
      },
    });
    const result = await service.list({ pageSize: 1 }, request());
    expect(result.total).toBe(1);
    expect(result.items.map((r) => r.id)).toEqual([visible]);
    expect(await service.list({ page: 2, pageSize: 1 }, request())).toMatchObject({ items: [], total: 1 });
  });
  it("does not grant review through system-management groups or account-created groups", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
    const group = await globalGroup([Permission.OAUTH_CLIENT_SYSTEM_MANAGE]);
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: group.id },
      data: { permissions: [Permission.OAUTH_CLIENT_REVIEW_READ], accountOwnerId: owner },
    });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("includes authorized owner names, omits system apps and never selects secret hashes", async () => {
    await globalGroup();
    await client(foreign, true);
    const query = vi.spyOn(prisma.oAuthClient, "findMany"),
      result = await service.list({}, request());
    expect(result.total).toBe(2);
    for (const row of result.items) {
      expect(row.isSystemClient).toBe(false);
      expect(row.user.username).toBeTruthy();
      expect(row).not.toHaveProperty("clientSecretHash");
    }
    for (const [args] of query.mock.calls) expect(args?.select).not.toHaveProperty("clientSecretHash");
  });
  it("rechecks membership after loading fields and rejects a revoked group", async () => {
    const group = await globalGroup(),
      hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.group.update({ where: { id: group.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed when applications change after loading display data", async () => {
    await globalGroup();
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.oAuthClient.update({ where: { id: visible }, data: { updateTime: new Date(Date.now() + 1000) } });
      return rows;
    });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies review status and keyword filters before the authorized count", async () => {
    await globalGroup();
    await prisma.oAuthClient.update({
      where: { id: visible },
      data: { name: "unique-review-target", reviewStatus: "pending", submittedAt: new Date() },
    });
    const result = await service.list({ reviewStatus: "pending", keyword: "unique-review-target" }, request());
    expect(result.total).toBe(1);
    expect(result.items.map((r) => r.id)).toEqual([visible]);
    expect(await service.list({ reviewStatus: "approved", keyword: "unique-review-target" }, request())).toMatchObject({
      items: [],
      total: 0,
    });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
