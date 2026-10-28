import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformLifecycleControlIamService } from "@/services/system/platform-lifecycle-control-iam.service";
import { PlatformLifecycleControlRepository } from "@/store/system/platform-lifecycle-control.repository";
import BusinessLogService from "@/services/system/businesslog.service";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { DataLifecycleService } from "@/services/system/data-lifecycle.service";
import { PermissionService } from "@/services/users/permission.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { platformLifecycleDatasetArn } from "@/iam/resources/platform-lifecycle-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformLifecycleControlIamService.getInstance(),
  bridge = DataLifecycleService.getInstance();
const updatePolicy = "quyan:system:data_lifecycle:UpdatePolicy" as const,
  updateSchedule = "quyan:system:data_lifecycle:UpdateSchedule" as const;
let owner: string, actor: string;
async function user(accountOwnerId?: string) {
  return (
    await prisma.user.create({
      data: {
        username: "lifecycle-iam-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
}
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: { "x-action": "*" },
    ip: "127.0.0.1",
  }) as unknown as TypedRequest;
beforeEach(async () => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  await prisma.serverConfig.deleteMany({ where: { key: { in: Object.values(CONFIG_KEYS.DATA_LIFECYCLE) } } });
  vi.spyOn(BusinessLogService.getInstance(), "logOperation").mockResolvedValue(undefined);
  owner = await user();
  actor = await user(owner);
  await bridge.initialize();
  await prisma.dataLifecyclePolicy.update({
    where: { dataset: "api_logs" },
    data: { enabled: true, hotRetentionDays: 90, status: 1 },
  });
  vi.spyOn(bridge as any, "countCandidates").mockResolvedValue(3);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.security.iamAuthorizationMode = "enforce";
});
async function group(permissions = [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE]) {
  const g = await prisma.group.create({
    data: {
      username: "lifecycle-" + randomUUID(),
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
      name: "lifecycle-" + randomUUID(),
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
async function deny(action: string, resource = "*") {
  return bind({ Version: "1", Statement: { Effect: "Deny", Action: action, Resource: resource } });
}

const policyInput = { enabled: false, hotRetentionDays: 45 },
  scheduleInput = { enabled: false, time: "12:34" };
describe("lifecycle control writes in authorization transactions", () => {
  it("updates only the selected dataset and preserves archive retention and candidate response", async () => {
    await group();
    const before = await prisma.dataLifecyclePolicy.findUniqueOrThrow({ where: { dataset: "api_logs" } });
    const result = await bridge.updatePolicyRequest("api_logs", policyInput, request());
    expect(result).toMatchObject({
      ...policyInput,
      dataset: "api_logs",
      candidateCount: 3,
      archiveRetentionDays: before.archiveRetentionDays,
    });
    expect((await prisma.dataLifecyclePolicy.findUniqueOrThrow({ where: { dataset: "business_logs" } })).enabled).toBe(
      true,
    );
    expect(BusinessLogService.getInstance().logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: actor, changes: { dataset: "api_logs", ...policyInput }, success: true }),
    );
  });
  it("atomically creates or updates just the two registered schedule settings", async () => {
    await group();
    expect(await bridge.updateScheduleRequest(scheduleInput, request())).toEqual({
      ...scheduleInput,
      timezone: "Asia/Shanghai",
    });
    const rows = await prisma.serverConfig.findMany({
      where: { key: { in: Object.values(CONFIG_KEYS.DATA_LIFECYCLE) } },
    });
    expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toEqual({
      [CONFIG_KEYS.DATA_LIFECYCLE.SCHEDULE_ENABLED]: "false",
      [CONFIG_KEYS.DATA_LIFECYCLE.SCHEDULE_TIME]: "12:34",
    });
    expect(await bridge.updateScheduleRequest({ enabled: true, time: "05:20" }, request())).toMatchObject({
      enabled: true,
      time: "05:20",
    });
  });
  it("does not treat read permission as an update grant and respects independent resource Deny", async () => {
    await group();
    await deny(updatePolicy, platformLifecycleDatasetArn("api_logs"));
    await deny(updateSchedule);
    await expect(bridge.updatePolicyRequest("api_logs", policyInput, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(bridge.updateScheduleRequest(scheduleInput, request())).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.dataLifecyclePolicy.findUniqueOrThrow({ where: { dataset: "api_logs" } })).enabled).toBe(true);
    expect(await prisma.serverConfig.count({ where: { key: { in: Object.values(CONFIG_KEYS.DATA_LIFECYCLE) } } })).toBe(
      0,
    );
    expect(BusinessLogService.getInstance().logOperation).not.toHaveBeenCalled();
  });
  it("does not grant the global management ceiling through broad policies or private groups", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE] },
    });
    await expect(bridge.updatePolicyRequest("api_logs", policyInput, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    const g = await group();
    await prisma.group.update({ where: { id: g.id }, data: { accountOwnerId: owner } });
    await expect(bridge.updateScheduleRequest(scheduleInput, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects stale policy versions without overwriting another update", async () => {
    await group();
    const guard = (await service.prepare(updatePolicy, request(), "api_logs"))!;
    await prisma.dataLifecyclePolicy.update({ where: { dataset: "api_logs" }, data: { hotRetentionDays: 99 } });
    await expect(service.updatePolicy(guard, policyInput)).rejects.toMatchObject({ statusCode: 403 });
    expect(
      (await prisma.dataLifecyclePolicy.findUniqueOrThrow({ where: { dataset: "api_logs" } })).hotRetentionDays,
    ).toBe(99);
  });
  it("rejects stale schedule config snapshots and missing-to-existing races", async () => {
    await group();
    const guard = (await service.prepare(updateSchedule, request()))!;
    await prisma.serverConfig.create({ data: { key: CONFIG_KEYS.DATA_LIFECYCLE.SCHEDULE_TIME, value: "06:00" } });
    await expect(service.updateSchedule(guard, scheduleInput)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.serverConfig.count({ where: { key: CONFIG_KEYS.DATA_LIFECYCLE.SCHEDULE_ENABLED } })).toBe(0);
    expect(
      (await prisma.serverConfig.findUniqueOrThrow({ where: { key: CONFIG_KEYS.DATA_LIFECYCLE.SCHEDULE_TIME } })).value,
    ).toBe("06:00");
  });
  it("rejects group and actor version changes after prepare, before transaction writes", async () => {
    const g = await group();
    const guard = (await service.prepare(updateSchedule, request()))!;
    await prisma.group.update({ where: { id: g.id }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.updateSchedule(guard, scheduleInput)).rejects.toMatchObject({ statusCode: 403 });
    const next = (await service.prepare(updatePolicy, request(), "api_logs"))!;
    await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
    await expect(service.updatePolicy(next, policyInput)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rolls back the dataset update if the final authorization check denies", async () => {
    await group();
    const guard = (await service.prepare(updatePolicy, request(), "api_logs"))!;
    const original = guard.users.recheck;
    let checks = 0;
    guard.users.recheck = async () => {
      await original();
      if (++checks === 2)
        throw new (await import("@/util/errors")).ForbiddenError("fixture final Deny", undefined, {
          messageKey: "permission.insufficientPermission",
        });
    };
    await expect(service.updatePolicy(guard, policyInput)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prisma.dataLifecyclePolicy.findUniqueOrThrow({ where: { dataset: "api_logs" } })).enabled).toBe(true);
  });
  it("rolls back both schedule settings if the final authorization check fails", async () => {
    await group();
    const guard = (await service.prepare(updateSchedule, request()))!;
    const original = guard.users.recheck;
    let checks = 0;
    guard.users.recheck = async () => {
      await original();
      if (++checks === 2)
        throw new (await import("@/util/errors")).ForbiddenError("fixture final Deny", undefined, {
          messageKey: "permission.insufficientPermission",
        });
    };
    await expect(service.updateSchedule(guard, scheduleInput)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.serverConfig.count({ where: { key: { in: Object.values(CONFIG_KEYS.DATA_LIFECYCLE) } } })).toBe(
      0,
    );
  });
  it("does not allow unknown fields, archive retention changes, invalid datasets or invalid time", async () => {
    await group();
    await expect(
      bridge.updatePolicyRequest("api_logs", { ...policyInput, archiveRetentionDays: 1 } as any, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(bridge.updatePolicyRequest("*", policyInput, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(bridge.updateScheduleRequest({ enabled: true, time: "25:00" }, request())).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      bridge.updateScheduleRequest({ ...scheduleInput, key: "other-config" } as any, request()),
    ).rejects.toMatchObject({ statusCode: 400 });
    const guard = (await service.prepare(updatePolicy, request(), "api_logs"))!;
    await expect(service.updatePolicy(guard, { ...policyInput, status: 0 } as any)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.dataLifecyclePolicy.findUniqueOrThrow({ where: { dataset: "api_logs" } })).enabled).toBe(true);
  });
  it("does not return post-save candidate counts when revocation occurs while computing them", async () => {
    const g = await group();
    vi.mocked((bridge as any).countCandidates).mockImplementation(async () => {
      await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
      return 3;
    });
    await expect(bridge.updatePolicyRequest("api_logs", policyInput, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    // The authorized write committed before revocation; only stale response data is suppressed.
    expect((await prisma.dataLifecyclePolicy.findUniqueOrThrow({ where: { dataset: "api_logs" } })).enabled).toBe(
      false,
    );
  });
  it("uses role policy grants rather than inheriting the user's group grant", async () => {
    await group();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "lifecycle-control-" + randomUUID() },
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
    await expect(bridge.updatePolicyRequest("api_logs", policyInput, req)).rejects.toMatchObject({ statusCode: 403 });
    const b = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: updatePolicy, Resource: platformLifecycleDatasetArn("api_logs") },
    });
    await prisma.ramAuthorization.update({
      where: { id: b.id },
      data: { principalType: "role", principalId: role.id },
    });
    expect(await bridge.updatePolicyRequest("api_logs", policyInput, req)).toMatchObject(policyInput);
    await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await expect(bridge.updatePolicyRequest("api_logs", policyInput, req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)("keeps %s legacy writes once without native mutations", async (mode) => {
    await group();
    env.security.iamAuthorizationMode = mode;
    vi.spyOn(PermissionService.getInstance(), "checkUserPermissions").mockResolvedValue({
      hasPermission: true,
      missingPermissions: [],
      checkedPermissions: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE],
    });
    const legacy = vi
      .spyOn(bridge, "updateSchedule")
      .mockResolvedValue({ enabled: false, time: "12:34", timezone: "Asia/Shanghai" });
    const native = vi.spyOn(PlatformLifecycleControlRepository.getInstance(), "updateSchedule");
    expect(await bridge.updateScheduleRequest(scheduleInput, request())).toMatchObject(scheduleInput);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
  });
});
