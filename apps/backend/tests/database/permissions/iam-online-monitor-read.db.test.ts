import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { UserOnlineMonitorRepository } from "@/store/users/user-online-monitor.repository";
import { UserOnlineMonitorIamService } from "@/services/users/user-online-monitor-iam.service";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { onlineSessionArn, onlineUserArn } from "@/iam/resources/online-session-resources";
import type { TypedRequest } from "@/types/express";
import type { IamPrincipal } from "@quyan/shared";
let owner: string, actor: string, peer: string, foreign: string;
const repository = UserOnlineMonitorRepository.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "online-read-" + randomUUID(),
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
      name: "online-read-" + randomUUID(),
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
describe("online monitor account and resource isolation", () => {
  it("scans metadata within the real account, and hydration skips changed snapshots", async () => {
    const selected = await session(),
      other = await session(foreign),
      targets = await repository.scan(principal());
    expect(targets.map((t) => t.id)).toEqual([selected.id]);
    expect(Object.keys(targets[0]).sort()).toEqual(["createTime", "id", "status", "updateTime", "userId"]);
    expect(targets.some((t) => t.id === other.id)).toBe(false);
    await prisma.userOnlineSession.update({
      where: { id: selected.id },
      data: { updateTime: new Date(targets[0].updateTime.getTime() + 1000) },
    });
    expect(await repository.hydrate(principal(), targets)).toEqual([]);
  });
  it("evaluates exact session grants and excludes denied sessions from counts and timelines", async () => {
    const visible = await session(),
      hidden = await session();
    await bind({
      Version: "1",
      Statement: [
        {
          Effect: "Allow",
          Action: ["quyan:user:ListOnlineSessions", "quyan:user:GetOnlineUserTimeline"],
          Resource: "acs:quyan:*:" + owner + ":online-session/" + peer + "/*",
        },
        { Effect: "Deny", Action: "quyan:user:*", Resource: onlineSessionArn(owner, peer, hidden.id) },
      ],
    });
    const service = UserOnlineMonitorIamService.getInstance(),
      overview = await service.overview({ page: 1, pageSize: 10 }, 60, request()),
      timeline = await service.timeline({ userId: peer, page: 1, pageSize: 10 }, 60, request());
    expect(overview.items.map((row) => row.sessionId)).toEqual([visible.id]);
    expect(overview.total).toBe(1);
    expect(overview.stats).toMatchObject({ onlineUsers: 1, offlineUsers: 0, activeSessions: 1 });
    expect(timeline.items.map((row) => row.sessionId)).toEqual([visible.id]);
    expect(timeline.total).toBe(1);
  });
  it("read-only expiry calculations cannot close same-account or foreign sessions", async () => {
    const expired = await session(peer, new Date(Date.now() - 120000)),
      foreignExpired = await session(foreign, new Date(Date.now() - 120000));
    await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:user:ListOnlineSessions",
        Resource: onlineSessionArn(owner, peer, expired.id),
      },
    });
    const result = await UserOnlineMonitorIamService.getInstance().overview({ page: 1, pageSize: 10 }, 60, request());
    expect(result.items[0].isOnline).toBe(false);
    expect(result.items[0].endedAt).toBeDefined();
    const unchanged = await prisma.userOnlineSession.findMany({
      where: { id: { in: [expired.id, foreignExpired.id] } },
      select: { endedAt: true, updateTime: true },
    });
    expect(unchanged.every((row) => row.endedAt === null)).toBe(true);
    expect(unchanged.find((row) => row.updateTime.getTime() === expired.updateTime.getTime())).toBeDefined();
  });
  it("requires separate user-level permission for detail and respects binding revocation", async () => {
    const selected = await session();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:user:ListOnlineSessions",
        Resource: onlineSessionArn(owner, peer, selected.id),
      },
    });
    const service = UserOnlineMonitorIamService.getInstance();
    await expect(service.detail(peer, 60, request())).rejects.toMatchObject({ statusCode: 403 });
    const binding = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:user:GetOnlineUser", Resource: onlineUserArn(owner, peer) },
    });
    expect(await service.detail(peer, 60, request())).toMatchObject({
      userId: peer,
      currentSessionCount: 1,
      totalSessions: 1,
    });
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(service.detail(peer, 60, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("blocks cross-account targets, disabled accounts and forged role sessions", async () => {
    await session();
    expect(await repository.userTarget(principal(), foreign)).toBeNull();
    await expect(repository.scan(principal(foreign))).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      repository.scan({ ...principal(), subjectType: "assumed_role", roleSessionId: "missing", assumedRoleId: "role" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
    await expect(repository.scan(principal())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("validates session resource-group ownership against persisted user membership", async () => {
    const selected = await session(),
      groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(onlineSessionArn(owner, peer, selected.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(onlineSessionArn(owner, actor, selected.id), owner)).toBe(false);
    expect(await groups.resourceExistsInAccount(onlineSessionArn(foreign, peer, selected.id), foreign)).toBe(false);
  });
});
