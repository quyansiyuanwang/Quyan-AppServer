import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/config/database";
import { env } from "@/config/env";
import { Permission } from "@quyan/shared";
import { PlatformLifecycleReadIamService } from "@/services/system/platform-lifecycle-read-iam.service";
import { DataLifecycleService } from "@/services/system/data-lifecycle.service";
import { ObservabilityRepository } from "@/store/system/observability.repository";
import { ConfigService } from "@/services/system/config.service";
import { PermissionService } from "@/services/users/permission.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import {
  platformLifecycleDatasetArn,
  platformLifecycleScheduleArn,
} from "@/iam/resources/platform-lifecycle-resources";
import type { TypedRequest } from "@/types/express";
const service = PlatformLifecycleReadIamService.getInstance(),
  bridge = DataLifecycleService.getInstance();
const list = "quyan:system:data_lifecycle:ListPolicies" as const,
  preview = "quyan:system:data_lifecycle:PreviewPolicy" as const;
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
  owner = await user();
  actor = await user(owner);
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
describe("platform lifecycle dataset and schedule reads", () => {
  it("filters denied datasets before counting and omits inactive policies", async () => {
    await group();
    await bridge.initialize();
    await deny(list, platformLifecycleDatasetArn("business_logs"));
    await prisma.dataLifecyclePolicy.update({ where: { dataset: "notification_logs" }, data: { status: 0 } });
    const count = vi.spyOn(bridge as any, "countCandidates").mockResolvedValue(7);
    const rows = await bridge.listPoliciesRequest(request());
    expect(rows).not.toEqual([]);
    expect(rows.every((r) => !["business_logs", "notification_logs"].includes(r.dataset))).toBe(true);
    expect(rows.every((r) => r.candidateCount === 7)).toBe(true);
    expect(count.mock.calls.some((args) => ["business_logs", "notification_logs"].includes(args[0] as string))).toBe(
      false,
    );
  });
  it("returns an empty denied list without reading policy metadata or candidate counts", async () => {
    await group();
    await deny(list);
    const metadata = vi.spyOn(ObservabilityRepository.getInstance(), "listLifecyclePolicies");
    const count = vi.spyOn(bridge as any, "countCandidates");
    expect(await bridge.listPoliciesRequest(request())).toEqual([]);
    expect(metadata).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
  it("does not grant platform eligibility through account ownership, wildcard policies or user additions", async () => {
    await bind({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } });
    await prisma.user.update({
      where: { id: actor },
      data: { permissionAdds: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE] },
    });
    const read = vi.fn();
    await expect(service.readDatasets(preview, ["api_logs"], request(), read)).rejects.toMatchObject({
      statusCode: 403,
    });
    const root = request();
    root.user!.userId = owner;
    root.authContext!.principalUserId = owner;
    await expect(service.readSchedule(root, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects private groups and a different platform management ceiling", async () => {
    const g = await group([Permission.SYSTEM_DATA_MAINTENANCE_MANAGE]);
    const read = vi.fn();
    await expect(service.readSchedule(request(), read)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.group.update({
      where: { id: g.id },
      data: { accountOwnerId: owner, permissions: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE] },
    });
    await expect(service.readSchedule(request(), read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps list, preview, candidates and schedule actions independent", async () => {
    await group();
    await bridge.initialize();
    await deny(preview);
    await deny("quyan:system:data_lifecycle:ListCandidates");
    vi.spyOn(bridge as any, "countCandidates").mockResolvedValue(1);
    expect((await bridge.listPoliciesRequest(request())).length).toBeGreaterThan(0);
    const policyRead = vi.spyOn(ObservabilityRepository.getInstance(), "getLifecyclePolicy");
    await expect(bridge.previewRequest("api_logs", request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(bridge.listCandidatesRequest("api_logs", 1, 20, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(policyRead).not.toHaveBeenCalled();
    expect(await service.readSchedule(request(), async () => "schedule")).toBe("schedule");
  });
  it("denies schedule reads before loading config and ignores client chosen actions", async () => {
    await group();
    await deny("quyan:system:data_lifecycle:GetSchedule", platformLifecycleScheduleArn());
    const config = vi.spyOn(ConfigService.getInstance(), "getMultiple");
    await expect(bridge.getScheduleRequest(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(config).not.toHaveBeenCalled();
  });
  it("rechecks all listed resources after counting and rejects a newly attached Deny", async () => {
    await group();
    await bridge.initialize();
    let added = false;
    vi.spyOn(bridge as any, "countCandidates").mockImplementation(async () => {
      if (!added) {
        added = true;
        await deny(list, platformLifecycleDatasetArn("api_logs"));
      }
      return 2;
    });
    await expect(bridge.listPoliciesRequest(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects global group revocation during candidate reads", async () => {
    const g = await group();
    await expect(
      service.readDatasets(preview, ["api_logs"], request(), async () => {
        await prisma.group.update({ where: { id: g.id }, data: { permissions: [] } });
        return { candidateCount: 2 };
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects user version changes and account owner disablement after work", async () => {
    await group();
    await expect(
      service.readSchedule(request(), async () => {
        await prisma.user.update({ where: { id: actor }, data: { updateTime: new Date(Date.now() + 1000) } });
        return 1;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.readSchedule(request(), async () => {
        await prisma.user.update({ where: { id: owner }, data: { status: 0 } });
        return 1;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("only uses role grants and rejects revoked sessions after work", async () => {
    await group();
    const role = await prisma.ramRole.create({
      data: { accountOwnerId: owner, name: "lifecycle-role-" + randomUUID() },
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
    const read = vi.fn().mockResolvedValue(1);
    await expect(service.readDatasets(preview, ["api_logs"], req, read)).rejects.toMatchObject({ statusCode: 403 });
    expect(read).not.toHaveBeenCalled();
    const authorization = await bind({
      Version: "1",
      Statement: { Effect: "Allow", Action: preview, Resource: platformLifecycleDatasetArn("api_logs") },
    });
    await prisma.ramAuthorization.update({
      where: { id: authorization.id },
      data: { principalType: "role", principalId: role.id },
    });
    expect(await service.readDatasets(preview, ["api_logs"], req, read)).toBe(1);
    await expect(
      service.readDatasets(preview, ["api_logs"], req, async () => {
        await prisma.ramRoleSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        return 1;
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never reads denied server log files", async () => {
    await group();
    await deny("quyan:system:data_lifecycle:ListCandidates", platformLifecycleDatasetArn("server_logs"));
    const files = vi.spyOn(bridge as any, "listServerLogCandidates");
    await expect(bridge.listCandidatesRequest("server_logs", 1, 20, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(files).not.toHaveBeenCalled();
  });
  it("keeps summaries redacted for authorized dataset candidates", async () => {
    await group();
    await bridge.initialize();
    vi.spyOn(bridge as any, "countCandidates").mockResolvedValue(1);
    vi.spyOn(ObservabilityRepository.getInstance(), "listDatasetCandidates").mockResolvedValue([
      {
        id: "candidate",
        createTime: new Date(),
        method: "GET",
        path: "/fixture?api_key=fixture-secret",
        statusCode: 200,
        requestID: "fixture",
      },
    ]);
    const result = await bridge.listCandidatesRequest("api_logs", 1, 20, request());
    expect(result.candidateCount).toBe(1);
    expect(result.items[0].summary).toContain("api_key=***");
    expect(result.items[0].summary).not.toContain("fixture-secret");
    expect(Object.keys(result.items[0]).sort()).toEqual(["createTime", "id", "summary"]);
  });
  it("does not read inactive dataset policies and rejects changes during previews", async () => {
    await group();
    await bridge.initialize();
    await prisma.dataLifecyclePolicy.update({ where: { dataset: "api_logs" }, data: { status: 0 } });
    const count = vi.spyOn(bridge as any, "countCandidates").mockResolvedValue(1);
    await expect(bridge.previewRequest("api_logs", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(count).not.toHaveBeenCalled();
    await prisma.dataLifecyclePolicy.update({ where: { dataset: "api_logs" }, data: { status: 1 } });
    count.mockImplementation(async () => {
      await prisma.dataLifecyclePolicy.update({ where: { dataset: "api_logs" }, data: { status: 0 } });
      return 1;
    });
    await expect(bridge.previewRequest("api_logs", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("fails closed on unavailable authorization data, OAuth and incomplete identity", async () => {
    await group();
    const read = vi.fn();
    const req = request();
    req.oauthAccessToken = { id: "fixture" } as any;
    await expect(service.readSchedule(req, read)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.readSchedule(undefined, read)).rejects.toMatchObject({ statusCode: 403 });
    const { IamAuthorizationService } = await import("@/iam/iam-authorization.service");
    vi.spyOn(IamAuthorizationService.getInstance(), "loadPolicies").mockRejectedValue(new Error("fixture unavailable"));
    await expect(service.readSchedule(request(), read)).rejects.toThrow("fixture unavailable");
    expect(read).not.toHaveBeenCalled();
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves %s read once, while keeping legacy permission denial",
    async (mode) => {
      await group();
      env.security.iamAuthorizationMode = mode;
      await deny(preview);
      const permissions = vi
        .spyOn(PermissionService.getInstance(), "checkUserPermissions")
        .mockResolvedValue({
          hasPermission: true,
          missingPermissions: [],
          checkedPermissions: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE],
        });
      const read = vi.fn().mockResolvedValue({ legacy: true });
      expect(await service.readDatasets(preview, ["api_logs"], request(), read)).toEqual({ legacy: true });
      expect(read).toHaveBeenCalledTimes(1);
      permissions.mockResolvedValue({
        hasPermission: false,
        checkedPermissions: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE],
        missingPermissions: [Permission.SYSTEM_DATA_LIFECYCLE_MANAGE],
      });
      await expect(service.readDatasets(preview, ["api_logs"], request(), read)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(read).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects unknown datasets and malformed pagination before repository work", async () => {
    await group();
    const read = vi.spyOn(ObservabilityRepository.getInstance(), "getLifecyclePolicy");
    await expect(bridge.previewRequest("*", request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(bridge.listCandidatesRequest("api_logs", 0, 20, request())).rejects.toMatchObject({ statusCode: 400 });
    await expect(bridge.listCandidatesRequest("api_logs", 1, 101, request())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(read).not.toHaveBeenCalled();
  });
});
