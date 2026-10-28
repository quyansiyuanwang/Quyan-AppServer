import { randomUUID } from "node:crypto";
import type { DataMaintenanceDataset } from "@/constant/data-maintenance-datasets";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformMaintenanceOptimizeIamService } from "@/services/system/platform-maintenance-optimize-iam.service";
import { DataMaintenanceService } from "@/services/system/data-maintenance.service";
import { PlatformMaintenanceOptimizeRepository } from "@/store/system/platform-maintenance-optimize.repository";
import { ObservabilityRepository } from "@/store/system/observability.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformMaintenanceDatasetArn } from "@/iam/resources/platform-maintenance-resources";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const action = "quyan:system:data_maintenance:CreateOptimizeRun" as const,
  service = PlatformMaintenanceOptimizeIamService.getInstance();
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "preview-iam-" + randomUUID(),
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
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  owner = await user();
  actor = await user(owner);
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
  vi.restoreAllMocks();
});
async function group(permissions = [Permission.SYSTEM_DATA_MAINTENANCE_MANAGE]) {
  const g = await prisma.group.create({
    data: {
      username: "preview-" + randomUUID(),
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
    policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "preview-" + randomUUID(),
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
const repository = PlatformMaintenanceOptimizeRepository.getInstance();
const preview = (datasets: DataMaintenanceDataset[] = ["api_logs"]) => ({
  totalRows: datasets.length,
  items: datasets.map((dataset) => ({
    dataset,
    tableName: dataset,
    rowCount: 1,
    dataBytes: 2,
    indexBytes: 3,
    executable: true,
  })),
});
describe("maintenance optimize creation database", () => {
  it("creates a queued run with server tables, owner, status and safe display selection", async () => {
    await group();
    const guard = (await service.prepare(["api_logs", "business_logs"], request()))!;
    const result = await service.create(guard, preview(["api_logs", "business_logs"]), "iam-optimize-fixture");
    expect(result).toMatchObject({
      operation: "optimize",
      runStatus: "queued",
      startedByUserId: actor,
      totalCount: 2,
      tableNames: ["api_logs", "business_logs"],
    });
    expect(result).not.toHaveProperty("tempObjectKey");
    expect(await prisma.dataMaintenanceRun.findUnique({ where: { id: result.id } })).toMatchObject({
      status: 1,
      tempObjectKey: null,
      dataset: null,
    });
  });
  it("denies unsupported group membership despite broad policy", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await expect(service.prepare(["api_logs"], request())).rejects.toMatchObject({ statusCode: 403 });
    const g = await group([Permission.SYSTEM_DATA_LIFECYCLE_MANAGE]);
    await expect(service.prepare(["api_logs"], request())).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: g.id },
      data: { accountOwnerId: owner, permissions: [Permission.SYSTEM_DATA_MAINTENANCE_MANAGE] },
    });
    await expect(service.prepare(["api_logs"], request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not borrow preview permissions for creation and requires all target grants", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: action, Resource: platformMaintenanceDatasetArn("business_logs") },
    });
    expect(await service.prepare(["api_logs"], request())).toBeDefined();
    await expect(service.prepare(["api_logs", "business_logs"], request())).rejects.toMatchObject({ statusCode: 403 });
    await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:system:data_maintenance:PreviewOptimize", Resource: "*" },
    });
    await expect(service.prepare(["business_logs"], request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects forged task data, tables, stages, unsafe counts or operation guards", async () => {
    await group();
    const guard = (await service.prepare(["api_logs"], request()))!;
    for (const input of [
      { ...preview(), status: 1 },
      { ...preview(), startedByUserId: owner },
      { ...preview(), tempObjectKey: "forged" },
      { ...preview(), totalRows: -1 },
      { ...preview(), totalRows: 2147483648 },
      { totalRows: 1, items: [{ ...preview().items[0], tableName: "users" }] },
      { totalRows: 1, items: [{ ...preview().items[0], dataset: "business_logs" }] },
      { totalRows: 1, items: [{ ...preview().items[0], rowCount: 0 }] },
    ])
      await expect(repository.create(guard, input as any)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      repository.create({ ...guard, action: "quyan:system:data_maintenance:PreviewOptimize" } as any, preview()),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.create(guard, preview(), "x".repeat(129))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back a newly inserted run after a final permission rejection", async () => {
    await group();
    const guard = (await service.prepare(["api_logs"], request()))!,
      original = guard.users.recheck;
    let calls = 0;
    guard.users.recheck = async () => {
      await original();
      if (++calls === 2) throw new Error("fixture final denial");
    };
    const count = await prisma.dataMaintenanceRun.count();
    await expect(service.create(guard, preview())).rejects.toThrow("fixture final denial");
    expect(await prisma.dataMaintenanceRun.count()).toBe(count);
  });
  it("rejects changed actors and groups before queue creation", async () => {
    const g = await group(),
      guard = (await service.prepare(["api_logs"], request()))!;
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.create(guard, preview())).rejects.toMatchObject({ statusCode: 403 });
    const newer = (await service.prepare(["api_logs"], request()))!;
    await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
    await expect(service.create(newer, preview())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses role-only grants and rejects revocation before queue commit", async () => {
    await group();
    const role = await prisma.ramRole.create({
        data: { accountOwnerId: owner, name: "optimize-role-" + randomUUID() },
      }),
      session = await prisma.ramRoleSession.create({
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
    await expect(service.prepare(["api_logs"], req)).rejects.toMatchObject({ statusCode: 403 });
    const b = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: action, Resource: platformMaintenanceDatasetArn("api_logs") },
    });
    await prisma.ramAuthorization.update({
      where: { id: b.id },
      data: { principalType: "role", principalId: role.id },
    });
    const guard = (await service.prepare(["api_logs"], req))!;
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(service.create(guard, preview())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects unknown confirmation and payload fields before querying statistics", async () => {
    await group();
    const bridge = DataMaintenanceService.getInstance(),
      stats = vi.spyOn(bridge, "optimizePreview");
    for (const body of [
      { datasets: ["api_logs"], confirmation: "OTHER" },
      { datasets: ["api_logs"], confirmation: "OPTIMIZE", startedByUserId: owner },
    ])
      await expect(bridge.createOptimizeRequest(body as any, request())).rejects.toMatchObject({ statusCode: 400 });
    expect(stats).not.toHaveBeenCalled();
  });
  it("authorizes the whole batch before statistics and queues native data without legacy writes", async () => {
    await group();
    const bridge = DataMaintenanceService.getInstance(),
      stats = vi.spyOn(bridge, "optimizePreview").mockResolvedValue({ ...preview(), totalBytes: 5 }),
      legacy = vi.spyOn(ObservabilityRepository.getInstance(), "createMaintenanceRun");
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: action, Resource: platformMaintenanceDatasetArn("business_logs") },
    });
    await expect(
      bridge.createOptimizeRequest({ datasets: ["api_logs", "business_logs"], confirmation: "OPTIMIZE" }, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(stats).not.toHaveBeenCalled();
    expect(
      await bridge.createOptimizeRequest({ datasets: ["api_logs"], confirmation: "OPTIMIZE" }, request()),
    ).toMatchObject({ runStatus: "queued", startedByUserId: actor });
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves the original queued task once in %s without a native duplicate",
    async (mode) => {
      await group();
      await bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: "*" } });
      env.security.iamAuthorizationMode = mode;
      const bridge = DataMaintenanceService.getInstance();
      vi.spyOn(bridge, "optimizePreview").mockResolvedValue({ ...preview(), totalBytes: 5 });
      const legacy = vi.spyOn(ObservabilityRepository.getInstance(), "createMaintenanceRun"),
        native = vi.spyOn(repository, "create");
      expect(
        await bridge.createOptimizeRequest({ datasets: ["api_logs"], confirmation: "OPTIMIZE" }, request()),
      ).toMatchObject({ runStatus: "queued" });
      expect(legacy).toHaveBeenCalledTimes(1);
      expect(native).not.toHaveBeenCalled();
    },
  );
  it.each(["legacy", "shadow"] as const)("denies absent old grants in %s before any queue write", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const bridge = DataMaintenanceService.getInstance(),
      legacy = vi.spyOn(ObservabilityRepository.getInstance(), "createMaintenanceRun");
    await expect(
      bridge.createOptimizeRequest({ datasets: ["api_logs"], confirmation: "OPTIMIZE" }, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).not.toHaveBeenCalled();
  });
});
