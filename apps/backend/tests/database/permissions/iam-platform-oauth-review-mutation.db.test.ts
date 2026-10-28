import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { PlatformOAuthReviewMutationIamService } from "@/services/users/platform-oauth-review-mutation-iam.service";
import { PlatformOAuthReviewMutationRepository } from "@/store/users/platform-oauth-review-mutation.repository";
import { platformOAuthReviewClientArn } from "@/iam/resources/platform-oauth-resources";
import { Permission } from "@quyan/shared";
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
const service = PlatformOAuthReviewMutationIamService.getInstance(),
  mutations = PlatformOAuthReviewMutationRepository.getInstance();
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
  await prisma.oAuthClient.update({
    where: { id: visible },
    data: { reviewStatus: "pending", submittedAt: new Date() },
  });
  hidden = await client(foreign);
});
async function globalGroup(permissions = [Permission.OAUTH_CLIENT_REVIEW_UPDATE]) {
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

const prepare = (
  action: "quyan:oauth:ReviewClient" | "quyan:oauth:DeleteReviewedClient" = "quyan:oauth:ReviewClient",
) => service.prepare(action, actor, visible, request());
describe("platform OAuth review mutation database", () => {
  it("reviews a real ordinary app across its platform resource and never exposes the hash", async () => {
    await globalGroup();
    const prepared = await prepare();
    expect(prepared!.existing.userId).toBe(foreign);
    const row = await service.mutate(prepared!.guard, { reviewStatus: "approved", reviewComment: "approved" });
    expect(row).toMatchObject({ id: visible, userId: foreign, reviewStatus: "approved", reviewedByUserId: actor });
    expect(row).not.toHaveProperty("clientSecretHash");
    expect((await prisma.oAuthClient.findUnique({ where: { id: hidden } }))!.reviewStatus).toBe("draft");
  });
  it("deletes ordinary approved apps through its independent sensitive action", async () => {
    await globalGroup();
    await prisma.oAuthClient.update({ where: { id: visible }, data: { reviewStatus: "approved" } });
    const prepared = await prepare("quyan:oauth:DeleteReviewedClient");
    await service.mutate(prepared!.guard);
    expect((await prisma.oAuthClient.findUnique({ where: { id: visible } }))!.status).toBe(-1);
    expect((await prisma.oAuthClient.findUnique({ where: { id: hidden } }))!.status).toBe(1);
  });
  it("requires review-update global membership and enforces per-operation Deny", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    const group = await globalGroup([Permission.OAUTH_CLIENT_REVIEW_READ]);
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: group.id },
      data: { permissions: [Permission.OAUTH_CLIENT_REVIEW_UPDATE], accountOwnerId: owner },
    });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: group.id }, data: { accountOwnerId: null } });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:oauth:ReviewClient",
        Resource: platformOAuthReviewClientArn(visible),
      },
    });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prepare("quyan:oauth:DeleteReviewedClient")).toBeDefined();
  });
  it("rejects system apps, stale app versions and nonpending or forged decisions", async () => {
    await globalGroup();
    const system = await client(foreign, true);
    await expect(service.prepare("quyan:oauth:DeleteReviewedClient", actor, system, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    const prepared = await prepare();
    await expect(
      mutations.mutate(prepared!.guard, { reviewStatus: "approved", userId: actor } as any),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.oAuthClient.update({ where: { id: visible }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(
      service.mutate(prepared!.guard, { reviewStatus: "rejected", reviewComment: null }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.oAuthClient.update({ where: { id: visible }, data: { reviewStatus: "approved" } });
    const nonpending = await prepare();
    await expect(
      service.mutate(nonpending!.guard, { reviewStatus: "rejected", reviewComment: null }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back both review decisions and deletions after a final policy denial", async () => {
    await globalGroup();
    for (const action of ["quyan:oauth:ReviewClient", "quyan:oauth:DeleteReviewedClient"] as const) {
      const prepared = await prepare(action),
        original = prepared!.guard.users.recheck;
      let calls = 0;
      prepared!.guard.users.recheck = async () => {
        await original();
        if (++calls === 2) throw new Error("fixture final deny");
      };
      await expect(
        service.mutate(
          prepared!.guard,
          action === "quyan:oauth:ReviewClient" ? { reviewStatus: "approved", reviewComment: null } : undefined,
        ),
      ).rejects.toThrow("fixture final deny");
      expect(await prisma.oAuthClient.findUnique({ where: { id: visible } })).toMatchObject({
        status: 1,
        reviewStatus: "pending",
        reviewedByUserId: null,
      });
    }
  });
  it("rejects changes to global membership and user versions before commit", async () => {
    const group = await globalGroup(),
      guard = (await prepare())!.guard;
    await prisma.group.update({ where: { id: group.id }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.mutate(guard, { reviewStatus: "approved", reviewComment: null })).rejects.toMatchObject({
      statusCode: 403,
    });
    const userGuard = (await prepare())!.guard;
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.mutate(userGuard, { reviewStatus: "approved", reviewComment: null })).rejects.toMatchObject({
      statusCode: 403,
    });
    const revoked = (await prepare("quyan:oauth:DeleteReviewedClient"))!.guard;
    await prisma.group.update({ where: { id: group.id }, data: { permissions: [] } });
    await expect(service.mutate(revoked)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.oAuthClient.findUnique({ where: { id: visible } })).toMatchObject({
      status: 1,
      reviewStatus: "pending",
    });
  });
  it("rejects a revoked active role session before reviewing", async () => {
    await globalGroup();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "review-role-" + randomUUID() } });
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:oauth:ReviewClient",
        Resource: platformOAuthReviewClientArn(visible),
      },
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "review-role-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "role",
        principalId: role.id,
        policyId: policy.id,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
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
    Object.assign(req.authContext!, { roleSessionId: session.id, assumedRoleId: role.id });
    const prepared = await service.prepare("quyan:oauth:ReviewClient", actor, visible, req);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(
      service.mutate(prepared!.guard, { reviewStatus: "approved", reviewComment: null }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
