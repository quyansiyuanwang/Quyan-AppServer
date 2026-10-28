import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { PlatformMaintenanceRunIamService } from "@/services/system/platform-maintenance-run-iam.service";
import { PlatformMaintenanceRunRepository } from "@/store/system/platform-maintenance-run.repository";
import { DataMaintenanceService } from "@/services/system/data-maintenance.service";
import { ObservabilityRepository } from "@/store/system/observability.repository";
import { platformMaintenanceRunArn } from "@/iam/resources/platform-maintenance-resources";
import { Permission } from "@quyan/shared";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string, visible: string, hidden: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "maintenance-iam-" + randomUUID(),
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
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
const service = PlatformMaintenanceRunIamService.getInstance(),
  repo = PlatformMaintenanceRunRepository.getInstance();
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.dataMaintenanceRun.updateMany({
    where: { requestId: { startsWith: "iam-maintenance-fixture-" } },
    data: { status: -1 },
  });
  owner = await user();
  actor = await user(owner);
  visible = (
    await prisma.dataMaintenanceRun.create({
      data: {
        operation: "optimize",
        requestId: "iam-maintenance-fixture-" + randomUUID(),
        tempObjectKey: "fixture-private-object",
        result: { completedTables: 1 },
      },
    })
  ).id;
  hidden = (
    await prisma.dataMaintenanceRun.create({
      data: {
        operation: "import",
        requestId: "iam-maintenance-fixture-" + randomUUID(),
        tempObjectKey: "fixture-private-other",
      },
    })
  ).id;
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  vi.restoreAllMocks();
});
async function group(permissions = [Permission.SYSTEM_DATA_MAINTENANCE_MANAGE]) {
  const g = await prisma.group.create({
    data: {
      username: "maintenance-" + randomUUID(),
      name: "fixture platform",
      level: 0,
      permissions,
      accountOwnerId: null,
    },
  });
  await prisma.user.update({ where: { id: actor }, data: { groupId: g.id } });
  return g;
}
async function bind(document: unknown) {
  const parsed = parseIamPolicy(document),
    p = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "maintenance-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
  return prisma.ramAuthorization.create({
    data: {
      accountOwnerId: owner,
      principalType: "user",
      principalId: actor,
      policyId: p.id,
      scopeType: "account",
      scopeKey: "account",
      createdBy: owner,
    },
  });
}
describe("platform maintenance run reads", () => {
  it("filters Deny before pagination, total and display-field reads", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:system:data_maintenance:ListRuns",
        Resource: platformMaintenanceRunArn(hidden),
      },
    });
    const hydrate = vi.spyOn(repo, "hydrate");
    expect(await service.list({ pageSize: 1 }, request())).toMatchObject({ total: 1, items: [{ id: visible }] });
    expect(await service.list({ page: 2, pageSize: 1 }, request())).toMatchObject({ total: 1, items: [] });
    expect(hydrate.mock.calls.flatMap(([, targets]) => targets.map((r) => r.id))).not.toContain(hidden);
  });
  it("never selects or returns private staging object keys", async () => {
    await group();
    const query = vi.spyOn(prisma.dataMaintenanceRun, "findMany");
    const rows = (await service.list({}, request())).items;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).not.toHaveProperty("tempObjectKey");
    for (const [args] of query.mock.calls) expect(args?.select).not.toHaveProperty("tempObjectKey");
    expect(await service.get(visible, request())).not.toHaveProperty("tempObjectKey");
  });
  it("requires platform membership even for broad policies, owners and user additions", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.SYSTEM_DATA_MAINTENANCE_MANAGE] },
    });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
    const g = await group([Permission.SYSTEM_DATA_LIFECYCLE_MANAGE]);
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: g.id },
      data: { permissions: [Permission.SYSTEM_DATA_MAINTENANCE_MANAGE], accountOwnerId: owner },
    });
    await expect(service.get(visible, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps list and detail grants independent", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: {
        Effect: "Deny",
        Action: "quyan:system:data_maintenance:GetRun",
        Resource: platformMaintenanceRunArn(visible),
      },
    });
    expect((await service.list({}, request())).total).toBe(2);
    await expect(service.get(visible, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await service.get(hidden, request())).toMatchObject({ id: hidden });
  });
  it("applies operation and status filters to the authorized count", async () => {
    await group();
    await prisma.dataMaintenanceRun.update({ where: { id: visible }, data: { runStatus: "completed" } });
    expect(await service.list({ operation: "optimize", runStatus: "completed" }, request())).toMatchObject({
      total: 1,
      items: [{ id: visible }],
    });
    expect(await service.list({ operation: "import", runStatus: "completed" }, request())).toMatchObject({
      total: 0,
      items: [],
    });
  });
  it("excludes disabled records and rejects missing, invalid, or OAuth-authenticated details", async () => {
    await group();
    await prisma.dataMaintenanceRun.update({ where: { id: hidden }, data: { status: 0 } });
    expect((await service.list({}, request())).total).toBe(1);
    for (const id of [hidden, "fixture-missing", "../invalid"])
      await expect(service.get(id, request())).rejects.toMatchObject({ statusCode: 403 });
    const req = request();
    req.oauthAccessToken = { id: "fixture-token" } as any;
    await expect(service.list({}, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks group revocation after loading display data", async () => {
    const g = await group(),
      hydrate = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
      return rows;
    });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects stale detail versions and final IAM revocations", async () => {
    await group();
    const hydrate = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.dataMaintenanceRun.update({
        where: { id: visible },
        data: { updateTime: new Date(Date.now() + 1000) },
      });
      return rows;
    });
    await expect(service.get(visible, request())).rejects.toMatchObject({ statusCode: 403 });
    vi.restoreAllMocks();
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.user.update({
        where: { id: actor },
        data: { permissionRemoves: [Permission.SYSTEM_DATA_MAINTENANCE_MANAGE] },
      });
      return rows;
    });
    await expect(service.get(visible, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses only role grants and rejects a session revoked during detail hydration", async () => {
    await group();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "maintenance-role-" + randomUUID() },
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
    Object.assign(req.authContext!, { assumedRoleId: role.id, roleSessionId: session.id });
    expect(await service.list({}, req)).toMatchObject({ total: 0, items: [] });
    const binding = await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: "quyan:system:data_maintenance:GetRun",
        Resource: platformMaintenanceRunArn(visible),
      },
    });
    await prisma.ramAuthorization.update({
      where: { id: binding.id },
      data: { principalType: "role", principalId: role.id },
    });
    expect(await service.get(visible, req)).toMatchObject({ id: visible });
    const hydrate = repo.hydrate.bind(repo);
    vi.spyOn(repo, "hydrate").mockImplementation(async (...args) => {
      const rows = await hydrate(...args);
      await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return rows;
    });
    await expect(service.get(visible, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("projects native records through the existing service without legacy queries", async () => {
    await group();
    const old = ObservabilityRepository.getInstance(),
      list = vi.spyOn(old, "listMaintenanceRuns"),
      get = vi.spyOn(old, "getMaintenanceRun");
    const bridge = DataMaintenanceService.getInstance();
    expect(await bridge.listRuns(1, 20, {}, request())).toMatchObject({ total: 2 });
    expect(await bridge.getRun(visible, request())).not.toHaveProperty("tempObjectKey");
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "uses original reads once and metadata-only diagnostics in %s",
    async (mode) => {
      await group();
      await bind({
        Version: "1",
        Statement: { Effect: "Deny", Action: "quyan:system:data_maintenance:*", Resource: "*" },
      });
      env.security.iamAuthorizationMode = mode;
      const old = ObservabilityRepository.getInstance(),
        list = vi.spyOn(old, "listMaintenanceRuns"),
        get = vi.spyOn(old, "getMaintenanceRun"),
        hydrate = vi.spyOn(repo, "hydrate");
      const bridge = DataMaintenanceService.getInstance();
      expect(await bridge.listRuns(1, 20, {}, request())).toMatchObject({ total: expect.any(Number) });
      expect(await bridge.getRun(visible, request())).toMatchObject({ id: visible });
      expect(list).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledTimes(1);
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
  it.each(["legacy", "shadow"] as const)("rejects old permission removals before reads in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const old = ObservabilityRepository.getInstance(),
      list = vi.spyOn(old, "listMaintenanceRuns"),
      get = vi.spyOn(old, "getMaintenanceRun");
    const bridge = DataMaintenanceService.getInstance();
    await expect(bridge.listRuns(1, 20, {}, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(bridge.getRun(visible, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(list).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
