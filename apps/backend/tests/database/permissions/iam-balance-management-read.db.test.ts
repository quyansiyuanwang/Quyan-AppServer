import { BalanceService } from "@/services/billing/balance.service";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { IamAccountUserRepository } from "@/store/users/iam-account-principal";
import { IamAccountUserAuthorizationService } from "@/services/users/iam-account-user-authorization.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { onlineUserArn } from "@/iam/resources/online-session-resources";
import type { TypedRequest } from "@/types/express";
import type { IamPrincipal } from "@quyan/shared";
let owner: string, actor: string, peer: string, foreign: string;
const repository = IamAccountUserRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "balance-read-" + randomUUID(),
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
const principal = (accountOwnerId = owner): IamPrincipal => ({
  subjectUserId: actor,
  principalUserId: actor,
  accountOwnerId,
  subjectType: "sub_user",
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
      name: "balance-read-" + randomUUID(),
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
describe("balance management account isolation and batch evaluation", () => {
  const action = "quyan:balance:GetUserBalance";
  it("reads only the specific real user allowed by native policies", async () => {
    await prisma.balanceAccount.create({ data: { userId: peer, balance: 15 } });
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: action, Resource: onlineUserArn(owner, peer) } });
    const service = IamAccountUserAuthorizationService.getInstance();
    const row = await service.read(action, peer, request(), (id) => BalanceService.getInstance().getBalance(id));
    expect(row.userId).toBe(peer);
    expect(Number(row.balance)).toBe(15);
    await expect(
      service.read(action, foreign, request(), (id) => BalanceService.getInstance().getBalance(id)),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("denies all of a requested batch when one target has an explicit Deny", async () => {
    await bind({
      Version: "1",
      Statement: [
        { Effect: "Allow", Action: action, Resource: [onlineUserArn(owner, peer), onlineUserArn(owner, actor)] },
        { Effect: "Deny", Action: action, Resource: onlineUserArn(owner, actor) },
      ],
    });
    let reads = 0;
    await expect(
      IamAccountUserAuthorizationService.getInstance().readMany(action, [peer, actor], request(), async () => {
        reads++;
        return [];
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(reads).toBe(0);
  });
  it("batches actual account targets and collapses duplicate IDs while preserving balance lookup order", async () => {
    await prisma.balanceAccount.create({ data: { userId: peer, balance: 15 } });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: action,
        Resource: [onlineUserArn(owner, peer), onlineUserArn(owner, actor)],
      },
    });
    const rows = await IamAccountUserAuthorizationService.getInstance().readMany(
      action,
      [peer, actor, peer],
      request(),
      (ids) => BalanceService.getInstance().getBatchBalances(ids),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.userId).toBe(peer);
    expect(rows[1]).toBeNull();
    expect((await repository.targets(principal(), [peer, actor, foreign])).map((t) => t.id).sort()).toEqual(
      [peer, actor].sort(),
    );
  });
  it("rejects cross-account batch members even with a wildcard user grant", async () => {
    await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: action, Resource: "acs:quyan:*:" + owner + ":user/*" },
    });
    await expect(
      IamAccountUserAuthorizationService.getInstance().readMany(action, [peer, foreign], request(), async () => []),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks grant revocation and user revisions before returning a batch", async () => {
    const binding = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: action, Resource: onlineUserArn(owner, peer) },
    });
    const service = IamAccountUserAuthorizationService.getInstance();
    await expect(
      service.readMany(action, [peer], request(), async () => {
        await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
        return [];
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: 1 } });
    await expect(
      service.readMany(action, [peer], request(), async () => {
        await prisma.user.update({ where: { id: peer }, data: { updateTime: new Date(Date.now() + 1000) } });
        return [];
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
