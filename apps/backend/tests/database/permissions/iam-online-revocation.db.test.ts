import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { UserOnlineRevocationRepository } from "@/store/users/user-online-revocation.repository";
import { UserOnlineRevocationIamService } from "@/services/users/user-online-revocation-iam.service";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { onlineSessionArn, onlineUserArn } from "@/iam/resources/online-session-resources";
import type { TypedRequest } from "@/types/express";
import type { IamPrincipal } from "@quyan/shared";
let owner: string, actor: string, peer: string, foreign: string;
const repository = UserOnlineRevocationRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "online-revoke-" + randomUUID(),
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
const session = (userId = peer, lastHeartbeatAt = new Date()) =>
  prisma.userOnlineSession.create({
    data: {
      userId,
      authSessionId: "fixture-" + randomUUID(),
      startedAt: new Date(lastHeartbeatAt.getTime() - 10000),
      lastHeartbeatAt,
      lastIpAddress: "127.0.0.1",
      lastLocation: "fixture",
      userAgent: "fixture",
    },
  });
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "online-revoke-" + randomUUID(),
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
describe("online revocation transactions", () => {
  it("closes only the authorized session snapshot and confirms the real authentication session identifier", async () => {
    const selected = await session(),
      other = await session(),
      target = (await repository.sessionTarget(principal(), selected.id))!;
    let marked: string | undefined;
    const result = await repository.closeSession(principal(), target, async (id) => {
      marked = id;
    });
    expect(result).toEqual({ closed: true, authSessionId: selected.authSessionId });
    expect(marked).toBe(selected.authSessionId);
    expect((await prisma.userOnlineSession.findUnique({ where: { id: other.id } }))?.endedAt).toBeNull();
    const refreshed = (await repository.sessionTarget(principal(), selected.id))!;
    expect(
      await repository.closeSession(principal(), refreshed, async () => {
        throw new Error("should not repeat");
      }),
    ).toEqual({ closed: false });
  });
  it("rolls back session closure if the external revocation marker cannot be confirmed", async () => {
    const selected = await session(),
      target = (await repository.sessionTarget(principal(), selected.id))!;
    await expect(
      repository.closeSession(principal(), target, async () => {
        throw new Error("fixture outage");
      }),
    ).rejects.toThrow("fixture outage");
    const current = await prisma.userOnlineSession.findUnique({ where: { id: selected.id } });
    expect(current?.endedAt).toBeNull();
    expect(current?.updateTime).toEqual(selected.updateTime);
  });
  it("rejects stale, misbound or cross-account session snapshots before any marker", async () => {
    const selected = await session(),
      target = (await repository.sessionTarget(principal(), selected.id))!;
    let calls = 0;
    const mark = async () => {
      calls++;
    };
    await expect(repository.closeSession(principal(foreign), target, mark)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.closeSession(principal(), { ...target, userId: actor }, mark)).rejects.toMatchObject({
      statusCode: 403,
    });
    await prisma.userOnlineSession.update({
      where: { id: selected.id },
      data: { updateTime: new Date(target.updateTime.getTime() + 1000) },
    });
    await expect(repository.closeSession(principal(), target, mark)).rejects.toMatchObject({ statusCode: 403 });
    expect(calls).toBe(0);
  });
  it("atomically ends the selected users sessions and advances their durable JWT revision", async () => {
    const first = await session(),
      second = await session(),
      untouched = await session(actor),
      target = (await repository.userTarget(principal(), peer))!;
    let marked: string | undefined;
    expect(
      await repository.closeUser(principal(), target, async (id) => {
        marked = id;
      }),
    ).toBe(2);
    expect(marked).toBe(peer);
    expect((await prisma.user.findUnique({ where: { id: peer } }))!.updateTime.getTime()).toBeGreaterThan(
      target.updateTime.getTime(),
    );
    const rows = await prisma.userOnlineSession.findMany({
      where: { id: { in: [first.id, second.id, untouched.id] } },
    });
    expect(rows.find((row) => row.id === untouched.id)?.endedAt).toBeNull();
    expect(rows.filter((row) => row.userId === peer).every((row) => row.endedAt !== null)).toBe(true);
  });
  it("rolls back user revision and every session closure when the marker fails", async () => {
    const selected = await session(),
      target = (await repository.userTarget(principal(), peer))!;
    await expect(
      repository.closeUser(principal(), target, async () => {
        throw new Error("fixture outage");
      }),
    ).rejects.toThrow("fixture outage");
    expect((await prisma.user.findUnique({ where: { id: peer } }))?.updateTime).toEqual(target.updateTime);
    expect((await prisma.userOnlineSession.findUnique({ where: { id: selected.id } }))?.endedAt).toBeNull();
  });
  it("protects account owner recovery even from delegated wildcard revocation", async () => {
    const rootSession = await session(owner);
    await expect(repository.userTarget(principal(), owner)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.sessionTarget(principal(), rootSession.id)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.userOnlineSession.findUnique({ where: { id: rootSession.id } }))?.endedAt).toBeNull();
  });
  it("checks account validity again inside the transaction", async () => {
    const selected = await session(),
      target = (await repository.sessionTarget(principal(), selected.id))!;
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(
      repository.closeSession(principal(), target, async () => {
        throw new Error("must not mark");
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.userOnlineSession.findUnique({ where: { id: selected.id } }))?.endedAt).toBeNull();
  });
  it("evaluates real scoped grants and immediate Deny before transaction entry", async () => {
    const selected = await session(),
      arn = onlineSessionArn(owner, peer, selected.id);
    await bind({
      Version: "1",
      Statement: [
        { Effect: "Allow", Action: "quyan:user:ForceOfflineSession", Resource: arn },
        { Effect: "Deny", Action: "quyan:user:ForceOfflineSession", Resource: arn },
      ],
    });
    const service = UserOnlineRevocationIamService.getInstance();
    await expect(service.authorizeSession(selected.id, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.userOnlineSession.findUnique({ where: { id: selected.id } }))?.endedAt).toBeNull();
  });
});
