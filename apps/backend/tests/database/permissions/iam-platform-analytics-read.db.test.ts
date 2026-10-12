import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import TrackService from "@/services/analytics/track.service";
import HeatmapService from "@/services/analytics/heatmap.service";
import { TrackEventRepository } from "@/store/analytics/track-event.repository";
import { platformSystemArn } from "@/iam/resources/platform-system-resources";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const originalMode = env.security.iamAuthorizationMode;
const tracks = TrackService.getInstance(),
  heatmaps = HeatmapService.getInstance();
const query = { startTime: 1, endTime: 100 },
  funnel = { ...query, steps: ["visit", "buy"] },
  heatQuery = { ...query, page: "/fixture", pointType: "click" as const };
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "analytics-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
async function group() {
  const row = await prisma.group.create({
    data: {
      username: "analytics-" + randomUUID(),
      name: "fixture global",
      level: 0,
      permissions: [Permission.ANALYTICS_READ],
      accountOwnerId: null,
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: row.id } });
  return row;
}
async function bind(document: unknown, principalType = "user", principalId = actor) {
  const parsed = parseIamPolicy(document);
  const policy = await RamPolicyRepository.getInstance().createPolicy({
    accountOwnerId: owner,
    name: "analytics-" + randomUUID(),
    permissions: [],
    iamVersion: { ...parsed, createdBy: owner },
  });
  await prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType,
      principalId,
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
  owner = await user();
  actor = await user(owner);
  await prisma.trackEvent.deleteMany();
  await prisma.heatmapPoint.deleteMany();
  await prisma.trackEvent.createMany({
    data: ["visit", "buy"].map((name, i) => ({
      eventType: "custom",
      name,
      page: "/fixture",
      sessionId: "fixture-session",
      clientTime: BigInt(1 + i),
      serverTime: BigInt(1 + i),
    })),
  });
  await prisma.heatmapPoint.createMany({
    data: [1, 2].map((n) => ({
      page: "/fixture",
      pointType: "click",
      xRatio: 0.1,
      yRatio: 0.2,
      viewportW: 1280,
      viewportH: 720,
      sessionId: "fixture-session-" + n,
      serverTime: BigInt(n),
    })),
  });
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});
describe("platform analytics report authorization database", () => {
  it("reads real deployment aggregates with the matching global group", async () => {
    await group();
    const stats = await tracks.getManagedStats(query, request());
    expect(stats).toMatchObject({ uvCount: 1, pvList: [{ page: "/fixture", count: 2 }] });
    expect((await tracks.getManagedFunnel(funnel, request())).steps.map((s) => s.users)).toEqual([1, 1]);
    expect(await heatmaps.queryManaged(heatQuery, request())).toEqual({
      points: [{ xRatio: 0.1, yRatio: 0.2, count: 2 }],
    });
    expect(JSON.stringify(stats)).not.toContain("fixture-session");
  });
  it("cannot derive deployment eligibility from account ownership or account policies", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(tracks.getManagedStats(query, request())).rejects.toMatchObject({ statusCode: 403 });
    const ownerReq = request();
    ownerReq.user!.userId = owner;
    ownerReq.authContext!.principalUserId = owner;
    await expect(heatmaps.queryManaged(heatQuery, ownerReq)).rejects.toMatchObject({ statusCode: 403 });
    const row = await group();
    await prisma.group.update({ where: { id: row.id }, data: { accountOwnerId: owner } });
    await expect(tracks.getManagedFunnel(funnel, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("honors report-specific Deny without granting sibling reports", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:analytics:GetFunnelStatistics",
        Resource: platformSystemArn("tracking-funnel"),
      },
    });
    expect((await tracks.getManagedStats(query, request())).uvCount).toBe(1);
    await expect(tracks.getManagedFunnel(funnel, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await heatmaps.queryManaged(heatQuery, request())).points).toHaveLength(1);
  });
  it("discards loaded aggregates on group revocation or a new Deny before return", async () => {
    const global = await group(),
      repo = TrackEventRepository.getInstance(),
      original = repo.getStats.bind(repo);
    vi.spyOn(repo, "getStats").mockImplementation(async (q) => {
      const data = await original(q);
      await prisma.group.update({ where: { id: global.id }, data: { permissions: [] } });
      return data;
    });
    await expect(tracks.getManagedStats(query, request())).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    await prisma.group.update({ where: { id: global.id }, data: { permissions: [Permission.ANALYTICS_READ] } });
    vi.spyOn(repo, "getStats").mockImplementation(async (q) => {
      const data = await original(q);
      await bind({
        Version: "1",
        Statement: {
          Effect: "Deny",
          Action: "quyan:analytics:GetTrackingStatistics",
          Resource: platformSystemArn("tracking-stats"),
        },
      });
      return data;
    });
    await expect(tracks.getManagedStats(query, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses only role-session grants for AssumeRole and checks session revocation", async () => {
    await group();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "analytics-" + randomUUID() } });
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
    await expect(tracks.getManagedStats(query, req)).rejects.toMatchObject({ statusCode: 403 });
    await bind(
      {
        Version: "1",
        Statement: {
          Effect: "Allow",
          Action: "quyan:analytics:GetTrackingStatistics",
          Resource: platformSystemArn("tracking-stats"),
        },
      },
      "role",
      role.id,
    );
    expect((await tracks.getManagedStats(query, req)).uvCount).toBe(1);
    await expect(heatmaps.queryManaged(heatQuery, req)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(tracks.getManagedStats(query, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "retains the old read in %s and avoids duplicate aggregate queries",
    async (mode) => {
      await group();
      env.security.iamAuthorizationMode = mode;
      await bind({
        Version: "1",
        Statement: {
          Effect: "Deny",
          Action: "quyan:analytics:GetTrackingStatistics",
          Resource: platformSystemArn("tracking-stats"),
        },
      });
      const read = vi.spyOn(TrackEventRepository.getInstance(), "getStats");
      expect((await tracks.getManagedStats(query, request())).uvCount).toBe(1);
      expect(read).toHaveBeenCalledOnce();
    },
  );
});
