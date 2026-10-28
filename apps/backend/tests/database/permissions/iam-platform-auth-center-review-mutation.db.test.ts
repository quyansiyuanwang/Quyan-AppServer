import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { AuthCenterClientService } from "@/services/users/auth-center-client.service";
import { AuthCenterClientRepository } from "@/store/users/auth-center-client.repository";
import { PlatformAuthCenterReviewMutationIamService } from "@/services/users/platform-auth-center-review-mutation-iam.service";
import { PlatformAuthCenterReviewMutationRepository } from "@/store/users/platform-auth-center-review-mutation.repository";
import { platformAuthCenterReviewClientArn } from "@/iam/resources/platform-auth-center-resources";
import { Permission } from "@quyan/shared";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, foreign: string, visible: string, hidden: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "auth-center-review-write-" + randomUUID(),
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
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const service = PlatformAuthCenterReviewMutationIamService.getInstance(),
  mutations = PlatformAuthCenterReviewMutationRepository.getInstance();
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
  await prisma.authCenterClient.update({
    where: { id: visible },
    data: { reviewStatus: "pending", submittedAt: new Date() },
  });
  hidden = await client(foreign);
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  vi.restoreAllMocks();
});
async function globalGroup(permissions = [Permission.AUTH_CENTER_CLIENT_REVIEW_UPDATE]) {
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
  action:
    | "quyan:auth_center:ReviewClient"
    | "quyan:auth_center:DeleteReviewedClient" = "quyan:auth_center:ReviewClient",
) => service.prepare(action, actor, visible, request());
describe("platform Auth Center review mutation database", () => {
  it("does not let own-application actions authorize platform review mutations", async () => {
    await globalGroup();
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:auth_center:DeleteReviewedClient", Resource: "*" },
    });
    await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:auth_center:DeleteClient", Resource: "*" },
    });
    await expect(prepare("quyan:auth_center:DeleteReviewedClient")).rejects.toMatchObject({ statusCode: 403 });
    expect(await prepare()).toBeDefined();
  });
  it("rejects review comments and injected fields at the repository boundary", async () => {
    await globalGroup();
    const prepared = (await prepare())!;
    for (const decision of [
      { reviewStatus: "approved", reviewComment: 12 },
      { reviewStatus: "approved", reviewComment: "x".repeat(2001) },
      { reviewStatus: "approved", reviewComment: null, clientSecretHash: "forged" },
      { reviewStatus: "approved", reviewComment: null, userId: actor },
    ])
      await expect(service.mutate(prepared.guard, decision as any)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      reviewStatus: "pending",
      userId: foreign,
    });
  });
  it("rejects review decisions on a deletion guard and invalid operation guards", async () => {
    await globalGroup();
    const guard = (await prepare("quyan:auth_center:DeleteReviewedClient"))!.guard;
    await expect(service.mutate(guard, { reviewStatus: "approved", reviewComment: null })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.mutate({ ...guard, action: "quyan:auth_center:UpdateClient" } as any)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("does not return or audit a successful write after a final denial", async () => {
    await globalGroup();
    const prepared = (await prepare())!,
      original = prepared.guard.users.recheck;
    let checks = 0;
    prepared.guard.users.recheck = async () => {
      await original();
      if (++checks === 2) throw new Error("fixture final deny");
    };
    vi.spyOn(service, "prepare").mockResolvedValue(prepared);
    const rows = await prisma.businessLog.count();
    await expect(
      AuthCenterClientService.getInstance().reviewClient(visible, actor, { reviewStatus: "approved" }, request()),
    ).rejects.toThrow("fixture final deny");
    expect(await prisma.businessLog.count()).toBe(rows);
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
      reviewStatus: "pending",
    });
  });
  it("routes successful review and delete through native transactions and safe DTOs", async () => {
    await globalGroup();
    const legacy = AuthCenterClientRepository.getInstance(),
      update = vi.spyOn(legacy, "update"),
      del = vi.spyOn(legacy, "delete");
    const bridge = AuthCenterClientService.getInstance();
    const result = await bridge.reviewClient(
      visible,
      actor,
      { reviewStatus: "approved", reviewComment: " accepted " },
      request(),
    );
    expect(result).toMatchObject({
      id: visible,
      reviewStatus: "approved",
      reviewComment: "accepted",
      hasClientSecret: true,
    });
    expect(result).not.toHaveProperty("clientSecretHash");
    expect(update).not.toHaveBeenCalled();
    await bridge.deleteClientForReview(visible, actor, request());
    expect(del).not.toHaveBeenCalled();
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({ status: -1 });
  });
  it("rejects injected approval fields and mismatched actor before reading legacy records", async () => {
    await globalGroup();
    const legacy = vi.spyOn(AuthCenterClientRepository.getInstance(), "findById"),
      bridge = AuthCenterClientService.getInstance();
    await expect(
      bridge.reviewClient(visible, actor, { reviewStatus: "approved", reviewedByUserId: owner } as any, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(bridge.deleteClientForReview(visible, owner, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("keeps original review and delete exactly once in %s", async (mode) => {
    await globalGroup();
    await bind({ Version: "1", Statement: { Effect: "Deny", Action: "quyan:auth_center:*", Resource: "*" } });
    env.security.iamAuthorizationMode = mode;
    const legacy = AuthCenterClientRepository.getInstance(),
      update = vi.spyOn(legacy, "update"),
      del = vi.spyOn(legacy, "delete"),
      mutate = vi.spyOn(mutations, "mutate");
    const bridge = AuthCenterClientService.getInstance();
    expect(await bridge.reviewClient(visible, actor, { reviewStatus: "rejected" }, request())).toMatchObject({
      reviewStatus: "rejected",
    });
    await bridge.deleteClientForReview(visible, actor, request());
    expect(update).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "denies missing legacy review permissions in %s before mutating",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      const legacy = AuthCenterClientRepository.getInstance(),
        update = vi.spyOn(legacy, "update"),
        del = vi.spyOn(legacy, "delete");
      const bridge = AuthCenterClientService.getInstance();
      await expect(bridge.reviewClient(visible, actor, { reviewStatus: "approved" }, request())).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(bridge.deleteClientForReview(visible, actor, request())).rejects.toMatchObject({ statusCode: 403 });
      expect(update).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    },
  );

  it("reviews a real ordinary app across its platform resource and never exposes the hash", async () => {
    await globalGroup();
    const prepared = await prepare();
    expect(prepared!.existing.userId).toBe(foreign);
    const row = await service.mutate(prepared!.guard, { reviewStatus: "approved", reviewComment: "approved" });
    expect(row).toMatchObject({ id: visible, userId: foreign, reviewStatus: "approved", reviewedByUserId: actor });
    expect(row).not.toHaveProperty("clientSecretHash");
    expect((await prisma.authCenterClient.findUnique({ where: { id: hidden } }))!.reviewStatus).toBe("draft");
  });
  it("deletes ordinary approved apps through its independent sensitive action", async () => {
    await globalGroup();
    await prisma.authCenterClient.update({ where: { id: visible }, data: { reviewStatus: "approved" } });
    const prepared = await prepare("quyan:auth_center:DeleteReviewedClient");
    await service.mutate(prepared!.guard);
    expect((await prisma.authCenterClient.findUnique({ where: { id: visible } }))!.status).toBe(-1);
    expect((await prisma.authCenterClient.findUnique({ where: { id: hidden } }))!.status).toBe(1);
  });
  it("requires review-update global membership and enforces per-operation Deny", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    const group = await globalGroup([Permission.AUTH_CENTER_CLIENT_REVIEW_READ]);
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: group.id },
      data: { permissions: [Permission.AUTH_CENTER_CLIENT_REVIEW_UPDATE], accountOwnerId: owner },
    });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({ where: { id: group.id }, data: { accountOwnerId: null } });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:auth_center:ReviewClient",
        Resource: platformAuthCenterReviewClientArn(visible),
      },
    });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect(await prepare("quyan:auth_center:DeleteReviewedClient")).toBeDefined();
  });
  it("rejects disabled apps, stale app versions and nonpending or forged decisions", async () => {
    await globalGroup();
    const system = await client(foreign);
    await prisma.authCenterClient.update({ where: { id: system }, data: { status: 0 } });
    await expect(
      service.prepare("quyan:auth_center:DeleteReviewedClient", actor, system, request()),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    const prepared = await prepare();
    await expect(
      mutations.mutate(prepared!.guard, { reviewStatus: "approved", userId: actor } as any),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.authCenterClient.update({ where: { id: visible }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(
      service.mutate(prepared!.guard, { reviewStatus: "rejected", reviewComment: null }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.authCenterClient.update({ where: { id: visible }, data: { reviewStatus: "approved" } });
    const nonpending = await prepare();
    await expect(
      service.mutate(nonpending!.guard, { reviewStatus: "rejected", reviewComment: null }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back both review decisions and deletions after a final policy denial", async () => {
    await globalGroup();
    for (const action of ["quyan:auth_center:ReviewClient", "quyan:auth_center:DeleteReviewedClient"] as const) {
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
          action === "quyan:auth_center:ReviewClient" ? { reviewStatus: "approved", reviewComment: null } : undefined,
        ),
      ).rejects.toThrow("fixture final deny");
      expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
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
    const revoked = (await prepare("quyan:auth_center:DeleteReviewedClient"))!.guard;
    await prisma.group.update({ where: { id: group.id }, data: { permissions: [] } });
    await expect(service.mutate(revoked)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.authCenterClient.findUnique({ where: { id: visible } })).toMatchObject({
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
        Action: "quyan:auth_center:ReviewClient",
        Resource: platformAuthCenterReviewClientArn(visible),
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
    const prepared = await service.prepare("quyan:auth_center:ReviewClient", actor, visible, req);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(
      service.mutate(prepared!.guard, { reviewStatus: "approved", reviewComment: null }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
