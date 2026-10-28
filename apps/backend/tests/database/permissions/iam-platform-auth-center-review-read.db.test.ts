import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { AuthCenterClientService } from "@/services/users/auth-center-client.service";
import { AuthCenterClientRepository } from "@/store/users/auth-center-client.repository";
import { PlatformAuthCenterReviewIamService } from "@/services/users/platform-auth-center-review-iam.service";
import { platformAuthCenterReviewClientArn } from "@/iam/resources/platform-auth-center-resources";
import { Permission } from "@quyan/shared";
import { PlatformAuthCenterReviewRepository } from "@/store/users/platform-auth-center-review.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, foreign: string, visible: string, hidden: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "auth-center-review-read-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const client = async (userId: string) =>
  (
    await prisma.authCenterClient.create({
      data: {
        userId,
        name: "fixture",
        clientId: "fixture-" + randomUUID(),
        clientSecretHash: "fixture-hash-never-selected",
        clientSecretPreview: "fixture-mask",
        grantTypes: ["authorization_code"],
        scopes: ["auth_center_client"],
        redirectUris: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
const service = PlatformAuthCenterReviewIamService.getInstance(),
  repository = PlatformAuthCenterReviewRepository.getInstance();
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  // This file uses global review resources; remove only fixtures from earlier tests in its isolated worker database.
  await prisma.authCenterClient.updateMany({
    where: { clientId: { startsWith: "fixture-" } },
    data: { status: -1 },
  });
  owner = await user();
  actor = await user(owner);
  foreign = await user();
  visible = await client(foreign);
  hidden = await client(foreign);
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  vi.restoreAllMocks();
});
async function globalGroup(permissions = [Permission.AUTH_CENTER_CLIENT_REVIEW_READ]) {
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
describe("platform Auth Center review read database", () => {
  it("uses only role policy grants and rechecks session revocation before returning", async () => {
    await globalGroup();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "review-role-" + randomUUID() } });
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
    Object.assign(req.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
    expect(await service.list({}, req)).toMatchObject({ items: [], total: 0 });
    const binding = await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:auth_center:ListClientReviews",
        Resource: platformAuthCenterReviewClientArn(visible),
      },
    });
    await prisma.ramAuthorization.update({
      where: { id: binding.id },
      data: { principalType: "role", principalId: role.id },
    });
    expect((await service.list({}, req)).items.map((r) => r.id)).toEqual([visible]);
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return rows;
    });
    await expect(service.list({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses native filtered reviews and the safe DTO without querying legacy review records", async () => {
    await globalGroup();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:auth_center:ListClientReviews",
        Resource: platformAuthCenterReviewClientArn(hidden),
      },
    });
    const legacy = vi.spyOn(AuthCenterClientRepository.getInstance(), "findReviewList");
    const result = await AuthCenterClientService.getInstance().listClientsForReview({}, request());
    expect(result).toMatchObject({
      total: 1,
      items: [{ id: visible, hasClientSecret: true, ownerUsername: expect.any(String) }],
    });
    expect(result.items[0]).not.toHaveProperty("clientSecretHash");
    expect(result.items[0]).not.toHaveProperty("clientSecret");
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "keeps the original review list once in %s without IAM hydration",
    async (mode) => {
      await globalGroup();
      await bind({
        Version: "1",
        Statement: { Effect: "Deny", Action: "quyan:auth_center:ListClientReviews", Resource: "*" },
      });
      env.security.iamAuthorizationMode = mode;
      const legacy = vi.spyOn(AuthCenterClientRepository.getInstance(), "findReviewList"),
        hydrate = vi.spyOn(repository, "hydrate");
      const result = await AuthCenterClientService.getInstance().listClientsForReview({}, request());
      expect(result.total).toBe(2);
      expect(legacy).toHaveBeenCalledTimes(1);
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
  it.each(["legacy", "shadow"] as const)(
    "rejects missing old review permissions in %s before querying",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const legacy = vi.spyOn(AuthCenterClientRepository.getInstance(), "findReviewList");
      await expect(AuthCenterClientService.getInstance().listClientsForReview({}, request())).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it("does not let account owners or extra permissions manufacture reviewer eligibility", async () => {
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.AUTH_CENTER_CLIENT_REVIEW_READ] },
    });
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
    const own = {
      user: { userId: owner },
      authContext: { principalUserId: owner, accountOwnerId: owner },
      headers: {},
    } as unknown as TypedRequest;
    await expect(service.list({}, own)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies explicit Deny from current effective policies despite platform group permission", async () => {
    await globalGroup();
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:auth_center:ListClientReviews", Resource: "*" },
    });
    expect(await service.list({}, request())).toMatchObject({ items: [], total: 0 });
  });
  it("does not accept an expired or missing assumed-role session", async () => {
    await globalGroup();
    const req = request();
    req.authContext = { ...req.authContext!, roleSessionId: "fixture-missing-session" };
    await expect(service.list({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks revoked IAM grants after displaying fields", async () => {
    await globalGroup();
    const hydrate = repository.hydrate.bind(repository);
    vi.spyOn(repository, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.user.update({
        where: { id: actor },
        data: { permissionRemoves: [Permission.AUTH_CENTER_CLIENT_REVIEW_READ] },
      });
      return rows;
    });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("excludes deleted applications without exposing their display data", async () => {
    await globalGroup();
    await prisma.authCenterClient.update({ where: { id: hidden }, data: { status: -1 } });
    const hydrate = vi.spyOn(repository, "hydrate");
    const result = await service.list({}, request());
    expect(result.items.map((r) => r.id)).toEqual([visible]);
    expect(hydrate.mock.calls.flatMap(([, targets]) => targets.map((r) => r.id))).not.toContain(hidden);
  });

  it("filters unauthorized applications before pagination and total", async () => {
    await globalGroup();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:auth_center:ListClientReviews",
        Resource: platformAuthCenterReviewClientArn(hidden),
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
      data: { permissions: [Permission.AUTH_CENTER_CLIENT_REVIEW_READ], accountOwnerId: owner },
    });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("includes authorized owner names and never selects secret hashes", async () => {
    await globalGroup();
    const query = vi.spyOn(prisma.authCenterClient, "findMany"),
      result = await service.list({}, request());
    expect(result.total).toBe(2);
    for (const row of result.items) {
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
      await prisma.authCenterClient.update({
        where: { id: visible },
        data: { updateTime: new Date(Date.now() + 1000) },
      });
      return rows;
    });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("applies review status and keyword filters before the authorized count", async () => {
    await globalGroup();
    await prisma.authCenterClient.update({
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
