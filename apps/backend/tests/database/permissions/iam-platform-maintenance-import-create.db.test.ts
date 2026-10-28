import { randomUUID, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformMaintenanceImportIamService } from "@/services/system/platform-maintenance-import-iam.service";
import { DataMaintenanceService } from "@/services/system/data-maintenance.service";
import { PlatformMaintenanceImportRepository } from "@/store/system/platform-maintenance-import.repository";
import { ObservabilityRepository } from "@/store/system/observability.repository";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformMaintenanceDatasetArn } from "@/iam/resources/platform-maintenance-resources";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const action = "quyan:system:data_maintenance:CreateImportRun" as const,
  service = PlatformMaintenanceImportIamService.getInstance();
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
    headers: { "x-maintenance-confirmation": "IMPORT" },
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
const repository = PlatformMaintenanceImportRepository.getInstance();
const input = () => ({
  objectKey:
    env.integrations.objectStorage.staging.prefix + "/maintenance/import/2026-10-13/1-" + "b".repeat(64) + ".ndjson.gz",
  totalCount: 2,
  invalidCount: 0,
  duplicateCount: 1,
});
function staging(buffer: Buffer) {
  const oss = {
    put: vi.fn().mockResolvedValue({}),
    head: vi.fn().mockResolvedValue({
      res: {
        headers: {
          "x-oss-meta-sha256": createHash("sha256").update(buffer).digest("hex"),
          "content-length": String(buffer.length),
          "x-oss-storage-class": "Standard",
        },
      },
    }),
    delete: vi.fn().mockResolvedValue({}),
  };
  vi.spyOn(DataMaintenanceService.getInstance() as any, "getOssClient").mockReturnValue(oss);
  return oss;
}
const archive = () =>
  gzipSync(
    Buffer.from(
      JSON.stringify({
        id: "fixture-archive-" + randomUUID(),
        requestID: "fixture",
        path: "/",
        method: "GET",
        ipAddress: "127.0.0.1",
        statusCode: 200,
      }),
    ),
  );
describe("maintenance import creation database", () => {
  it("creates queued imports with only server dataset, table, initiator and safe view", async () => {
    await group();
    const guard = (await service.prepare(["api_logs"], request()))!,
      result = await service.create(guard, input());
    expect(result).toMatchObject({
      operation: "import",
      runStatus: "queued",
      dataset: "api_logs",
      tableNames: ["api_logs"],
      startedByUserId: actor,
      totalCount: 2,
      result: { duplicateCount: 1 },
    });
    expect(result).not.toHaveProperty("tempObjectKey");
    expect(await prisma.dataMaintenanceRun.findUnique({ where: { id: result.id } })).toMatchObject({
      tempObjectKey: input().objectKey,
      status: 1,
    });
  });
  it("does not manufacture platform import eligibility from an account policy", async () => {
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
  it("does not borrow import preview or optimization rights to create imports", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: action, Resource: platformMaintenanceDatasetArn("api_logs") },
    });
    await bind({
      Version: "1",
      Statement: {
        Effect: "Allow",
        Action: ["quyan:system:data_maintenance:PreviewImport", "quyan:system:data_maintenance:CreateOptimizeRun"],
        Resource: "*",
      },
    });
    await expect(service.prepare(["api_logs"], request())).rejects.toMatchObject({ statusCode: 403 });
    expect(await service.prepare(["business_logs"], request())).toBeDefined();
  });
  it("rejects forged keys, counts, target tables and unrelated operation guards", async () => {
    await group();
    const guard = (await service.prepare(["api_logs"], request()))!;
    for (const value of [
      { ...input(), objectKey: "other/private" },
      { ...input(), objectKey: input().objectKey + "/other" },
      { ...input(), tableNames: ["users"] },
      { ...input(), startedByUserId: owner },
      { ...input(), invalidCount: 1 },
      { ...input(), totalCount: -1 },
      { ...input(), duplicateCount: 3 },
      { ...input(), totalCount: 2147483648 },
    ])
      await expect(repository.create(guard, value as any)).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      repository.create({ ...guard, action: "quyan:system:data_maintenance:CreateOptimizeRun" } as any, input()),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      repository.create({ ...guard, datasets: ["api_logs", "business_logs"] }, input()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back the queue record on a final denied decision", async () => {
    await group();
    const guard = (await service.prepare(["api_logs"], request()))!,
      original = guard.users.recheck;
    let calls = 0;
    guard.users.recheck = async () => {
      await original();
      if (++calls === 2) throw new Error("fixture final deny");
    };
    const total = await prisma.dataMaintenanceRun.count();
    await expect(service.create(guard, input())).rejects.toThrow("fixture final deny");
    expect(await prisma.dataMaintenanceRun.count()).toBe(total);
  });
  it("rejects stale user/group snapshots and revoked role sessions", async () => {
    const g = await group(),
      guard = (await service.prepare(["api_logs"], request()))!;
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.create(guard, input())).rejects.toMatchObject({ statusCode: 403 });
    const current = (await service.prepare(["api_logs"], request()))!;
    await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
    await expect(service.create(current, input())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps role-only rights and checks session revocation before commit", async () => {
    await group();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "import-role-" + randomUUID() } }),
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
    await expect(service.create(guard, input())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("authorizes before parsing or uploading and rejects missing confirmation", async () => {
    await group();
    const data = archive(),
      oss = staging(data),
      bridge = DataMaintenanceService.getInstance(),
      preview = vi.spyOn(bridge, "previewImport");
    await bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: "*" } });
    await expect(bridge.createImportRequest("api_logs", data, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(preview).not.toHaveBeenCalled();
    expect(oss.put).not.toHaveBeenCalled();
    const req = request();
    req.headers["x-maintenance-confirmation"] = "OTHER";
    await expect(bridge.createImportRequest("api_logs", data, req)).rejects.toMatchObject({ statusCode: 400 });
  });
  it("verifies uploaded content before native queue creation and omits private key", async () => {
    await group();
    const data = archive(),
      oss = staging(data),
      legacy = vi.spyOn(ObservabilityRepository.getInstance(), "createMaintenanceRun");
    const result = await DataMaintenanceService.getInstance().createImportRequest("api_logs", data, request());
    expect(result).toMatchObject({ runStatus: "queued", startedByUserId: actor, totalCount: 1 });
    expect(result).not.toHaveProperty("tempObjectKey");
    expect(legacy).not.toHaveBeenCalled();
    expect(oss.put).toHaveBeenCalledTimes(1);
    expect(oss.head).toHaveBeenCalledTimes(1);
    expect(oss.delete).not.toHaveBeenCalled();
  });
  it("cleans uploaded objects and does not enqueue on verification mismatch or metadata lookup failure", async () => {
    await group();
    const data = archive(),
      oss = staging(data),
      bridge = DataMaintenanceService.getInstance(),
      total = await prisma.dataMaintenanceRun.count();
    oss.head.mockResolvedValueOnce({
      res: {
        headers: {
          "x-oss-meta-sha256": "invalid",
          "content-length": String(data.length),
          "x-oss-storage-class": "Standard",
        },
      },
    });
    await expect(bridge.createImportRequest("api_logs", data, request())).rejects.toMatchObject({ statusCode: 400 });
    expect(oss.delete).toHaveBeenCalledTimes(1);
    oss.head.mockRejectedValueOnce(new Error("fixture head unavailable"));
    await expect(bridge.createImportRequest("api_logs", data, request())).rejects.toThrow("fixture head unavailable");
    expect(oss.delete).toHaveBeenCalledTimes(2);
    expect(await prisma.dataMaintenanceRun.count()).toBe(total);
  });
  it("cleans verified objects and rolls back tasks after a final policy failure", async () => {
    await group();
    const data = archive(),
      oss = staging(data),
      guard = (await service.prepare(["api_logs"], request()))!,
      original = guard.users.recheck;
    let calls = 0;
    guard.users.recheck = async () => {
      await original();
      if (++calls === 2) throw new Error("fixture final deny");
    };
    vi.spyOn(service, "prepare").mockResolvedValue(guard);
    const total = await prisma.dataMaintenanceRun.count();
    await expect(DataMaintenanceService.getInstance().createImportRequest("api_logs", data, request())).rejects.toThrow(
      "fixture final deny",
    );
    expect(oss.delete).toHaveBeenCalledTimes(1);
    expect(await prisma.dataMaintenanceRun.count()).toBe(total);
  });
  it("does not replace the original denial when cleanup storage is unavailable", async () => {
    await group();
    const data = archive(),
      oss = staging(data),
      total = await prisma.dataMaintenanceRun.count();
    oss.head.mockRejectedValueOnce(new Error("fixture head unavailable"));
    oss.delete.mockRejectedValueOnce(new Error("fixture cleanup unavailable"));
    await expect(DataMaintenanceService.getInstance().createImportRequest("api_logs", data, request())).rejects.toThrow(
      "fixture head unavailable",
    );
    expect(oss.delete).toHaveBeenCalledTimes(1);
    expect(await prisma.dataMaintenanceRun.count()).toBe(total);
  });
  it("attempts cleanup after a failed partial upload and never queues it", async () => {
    await group();
    const data = archive(),
      oss = staging(data),
      total = await prisma.dataMaintenanceRun.count();
    oss.put.mockRejectedValueOnce(new Error("fixture partial upload"));
    await expect(DataMaintenanceService.getInstance().createImportRequest("api_logs", data, request())).rejects.toThrow(
      "fixture partial upload",
    );
    expect(oss.head).not.toHaveBeenCalled();
    expect(oss.delete).toHaveBeenCalledTimes(1);
    expect(await prisma.dataMaintenanceRun.count()).toBe(total);
  });
  it("rejects a group revoked during upload and removes the verified staging object", async () => {
    const g = await group(),
      data = archive(),
      oss = staging(data),
      head = await oss.head();
    oss.head.mockClear();
    oss.head.mockImplementationOnce(async () => {
      await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
      return head;
    });
    const total = await prisma.dataMaintenanceRun.count();
    await expect(
      DataMaintenanceService.getInstance().createImportRequest("api_logs", data, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(oss.delete).toHaveBeenCalledTimes(1);
    expect(await prisma.dataMaintenanceRun.count()).toBe(total);
  });
  it("does not upload imports that fail existing archive validation", async () => {
    await group();
    const data = gzipSync(Buffer.from(JSON.stringify({ id: "bad", unknownColumn: "invalid" }))),
      oss = staging(data);
    await expect(
      DataMaintenanceService.getInstance().createImportRequest("api_logs", data, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(oss.put).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)("keeps original import creation once in %s", async (mode) => {
    await group();
    await bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: "*" } });
    env.security.iamAuthorizationMode = mode;
    const data = archive(),
      oss = staging(data),
      legacy = vi.spyOn(ObservabilityRepository.getInstance(), "createMaintenanceRun"),
      native = vi.spyOn(repository, "create");
    expect(await DataMaintenanceService.getInstance().createImportRequest("api_logs", data, request())).toMatchObject({
      runStatus: "queued",
    });
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
    expect(oss.put).toHaveBeenCalledTimes(1);
  });
  it.each(["legacy", "shadow"] as const)("rejects absent old import rights before upload in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const data = archive(),
      oss = staging(data);
    await expect(
      DataMaintenanceService.getInstance().createImportRequest("api_logs", data, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(oss.put).not.toHaveBeenCalled();
  });
});
