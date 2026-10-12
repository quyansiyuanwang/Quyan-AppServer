import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformMaintenancePreviewIamService } from "@/services/system/platform-maintenance-preview-iam.service";
import { DataMaintenanceService } from "@/services/system/data-maintenance.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformMaintenanceDatasetArn } from "@/iam/resources/platform-maintenance-resources";
import type { TypedRequest } from "@/types/express";
let owner: string, actor: string;
const action = "quyan:system:data_maintenance:PreviewOptimize" as const,
  service = PlatformMaintenancePreviewIamService.getInstance();
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
describe("maintenance dataset preview database", () => {
  it("grants real dataset previews to platform reviewers and denies one unauthorized batch target before work", async () => {
    await group();
    const read = vi.fn().mockResolvedValue({ totalRows: 2 });
    expect(await service.read(action, ["api_logs"], request(), read)).toEqual({ totalRows: 2 });
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: action, Resource: platformMaintenanceDatasetArn("business_logs") },
    });
    await expect(service.read(action, ["api_logs", "business_logs"], request(), read)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("does not give platform eligibility to broad policies, additions or private groups", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    const read = vi.fn();
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.SYSTEM_DATA_MAINTENANCE_MANAGE] },
    });
    await expect(service.read(action, ["api_logs"], request(), read)).rejects.toMatchObject({ statusCode: 403 });
    const g = await group([Permission.SYSTEM_DATA_LIFECYCLE_MANAGE]);
    await expect(service.read(action, ["api_logs"], request(), read)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: g.id },
      data: { permissions: [Permission.SYSTEM_DATA_MAINTENANCE_MANAGE], accountOwnerId: owner },
    });
    await expect(service.read(action, ["api_logs"], request(), read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps import and optimize preview permissions separate", async () => {
    await group();
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: "quyan:system:data_maintenance:PreviewImport", Resource: "*" },
    });
    expect(await service.read(action, ["api_logs"], request(), async () => 1)).toBe(1);
    await expect(
      service.read("quyan:system:data_maintenance:PreviewImport", ["api_logs"], request(), async () => 1),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects group revocation and version changes while previewing", async () => {
    const g = await group();
    await expect(
      service.read(action, ["api_logs"], request(), async () => {
        await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
        return 1;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: g.id },
      data: { permissions: [Permission.SYSTEM_DATA_MAINTENANCE_MANAGE] },
    });
    await expect(
      service.read(action, ["api_logs"], request(), async () => {
        await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
        return 1;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails final Deny and does not return dataset counts", async () => {
    await group();
    await expect(
      service.read(action, ["api_logs"], request(), async () => {
        await bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: "*" } });
        return { totalRows: 12 };
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses only role grants and rechecks session revocation", async () => {
    await group();
    const role = await prisma.ramRole.create({ data: { accountOwnerId: owner, name: "preview-role-" + randomUUID() } }),
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
    const read = vi.fn().mockResolvedValue(1);
    await expect(service.read(action, ["api_logs"], req, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
    const b = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: action, Resource: platformMaintenanceDatasetArn("api_logs") },
    });
    await prisma.ramAuthorization.update({
      where: { id: b.id },
      data: { principalType: "role", principalId: role.id },
    });
    expect(await service.read(action, ["api_logs"], req, read)).toBe(1);
    await expect(
      service.read(action, ["api_logs"], req, async () => {
        await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        return 1;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("authorizes the complete batch before table stats and omits imported record bodies", async () => {
    await group();
    const bridge = DataMaintenanceService.getInstance(),
      stats = vi.spyOn(bridge, "optimizePreview").mockResolvedValue({ items: [], totalRows: 0, totalBytes: 0 });
    await bind({
      Version: "1",
      Statement: { Effect: "Deny", Action: action, Resource: platformMaintenanceDatasetArn("business_logs") },
    });
    await expect(bridge.previewOptimizeRequest(["api_logs", "business_logs"], request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(stats).not.toHaveBeenCalled();
    const archive = gzipSync(
      Buffer.from(
        JSON.stringify({
          id: "fixture-import-" + randomUUID(),
          requestID: "fixture",
          path: "/",
          method: "GET",
          ipAddress: "127.0.0.1",
          statusCode: 200,
        }),
      ),
    );
    const result = await bridge.previewImportRequest("api_logs", archive, request());
    expect(result).toMatchObject({ dataset: "api_logs", totalCount: 1 });
    expect(result).not.toHaveProperty("rows");
  });
  it.each(["legacy", "shadow"] as const)("runs preview once despite IAM Deny in %s", async (mode) => {
    await group();
    await bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: "*" } });
    env.security.iamAuthorizationMode = mode;
    const read = vi.fn().mockResolvedValue(2);
    expect(await service.read(action, ["api_logs"], request(), read)).toBe(2);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it.each(["legacy", "shadow"] as const)("rejects absent legacy permission in %s before work", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    const read = vi.fn();
    await expect(service.read(action, ["api_logs"], request(), read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
});
