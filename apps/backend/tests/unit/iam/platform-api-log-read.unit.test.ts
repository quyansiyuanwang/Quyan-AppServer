import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/system/platform-api-log-read.repository", () => ({
  PlatformApiLogReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { Permission, iamActionsForLegacyPermission, iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { PlatformApiLogReadIamService } from "@/services/system/platform-api-log-read-iam.service";
import { platformApiLogArn } from "@/iam/resources/platform-api-log-resources";
import { platformApiLogResourceResolver } from "@/iam/request/platform-api-log-resource-resolvers";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import type { TypedRequest } from "@/types/express";
import type { SystemLogDetailDTO } from "@/api/dto/system/system.dto";
const action = "quyan:system:log:GetLogDetail",
  required = [Permission.API_LOG_READ, Permission.SYSTEM_LOG_READ];
const iam = { loadPolicies: vi.fn(), authorize: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { target: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformApiLogReadIamService(iam, snapshots, repository, permissions);
const target = { id: "log-one", status: 1, updateTime: new Date(0) };
const dto = () =>
  ({
    ...target,
    requestHeaders: { fixture: "protected-content" },
    response: { fixture: "protected-response" },
  }) as unknown as SystemLogDetailDTO;
const req = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner", subjectType: "sub_user" },
    params: { logId: target.id },
    headers: { "x-action": "quyan:ram:CreateUser" },
    secure: true,
  }) as unknown as TypedRequest;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "matched-allow", matchedStatements: [] });
  snapshots.snapshot.mockResolvedValue({});
  snapshots.recheck.mockResolvedValue(undefined);
  repository.target.mockResolvedValue(target);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true, checkedPermissions: required });
});
afterEach(() => {
  env.security.iamAuthorizationMode = "enforce";
});
describe("API request log detail resource authorization", () => {
  it("registers both legacy aliases for the same fixed Action", () => {
    expect(iamLegacyPermissionsForAction(action)).toEqual(required);
    for (const permission of required) expect(iamActionsForLegacyPermission(permission)).toContain(action);
    expect(iamLegacyPermissionsForAction("invented:Action")).toEqual([]);
  });
  it("builds a platform ARN from a validated ID and never accepts a client Action header", async () => {
    expect(platformApiLogArn(target.id)).toBe("acs:platform:*:platform:api-request-log/log-one");
    await service.read(target.id, req(), async () => dto());
    expect(
      iam.authorize.mock.calls.every(
        ([input]) => input.action === action && input.resource === platformApiLogArn(target.id),
      ),
    ).toBe(true);
    expect(snapshots.snapshot).toHaveBeenCalledWith(expect.objectContaining({ accountOwnerId: "owner" }), required);
    expect(JSON.stringify(vi.mocked(auditIamDecision).mock.calls)).not.toContain("protected-content");
  });
  it.each(["../log", "log/*", "", "log\n", "a".repeat(192)])("refuses invalid request resource %s", async (id) => {
    const hydrate = vi.fn();
    await expect(service.read(id, req(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
    const request = req();
    request.params.logId = id;
    expect(await platformApiLogResourceResolver({ request, principal: {} as never })).toBeUndefined();
    expect(hydrate).not.toHaveBeenCalled();
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("refuses %s before target or payload reads", async (decision) => {
    iam.authorize.mockResolvedValue({ decision, reason: "fixture", matchedStatements: [] });
    const hydrate = vi.fn();
    await expect(service.read(target.id, req(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("does not hydrate before global qualification and current identity are verified", async () => {
    snapshots.snapshot.mockRejectedValue(new Error("fixture unqualified"));
    const hydrate = vi.fn();
    await expect(service.read(target.id, req(), hydrate)).rejects.toThrow("fixture unqualified");
    expect(hydrate).not.toHaveBeenCalled();
  });
  it.each([null, { ...target, status: 0 }, { ...target, id: "other" }])(
    "refuses unavailable or mismatched metadata before hydration",
    async (record) => {
      repository.target.mockResolvedValue(record);
      const hydrate = vi.fn();
      await expect(service.read(target.id, req(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
      expect(hydrate).not.toHaveBeenCalled();
    },
  );
  it("rechecks the target version after hydration", async () => {
    repository.target.mockResolvedValueOnce(target).mockResolvedValueOnce({ ...target, updateTime: new Date(1) });
    await expect(service.read(target.id, req(), async () => dto())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("never returns a hydrated payload for another ID or revision", async () => {
    for (const changed of [
      { ...dto(), id: "other" },
      { ...dto(), updateTime: new Date(1) },
      { ...dto(), status: 0 },
    ])
      await expect(service.read(target.id, req(), async () => changed)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("discards payloads when identity or eligibility changes during hydration", async () => {
    await expect(
      service.read(target.id, req(), async () => {
        snapshots.recheck.mockRejectedValue(new Error("fixture revoked"));
        return dto();
      }),
    ).rejects.toThrow("fixture revoked");
  });
  it.each(required)("retains ANY semantics for %s in legacy mode", async (permission) => {
    env.security.iamAuthorizationMode = "legacy";
    permissions.checkUserPermissions.mockResolvedValue({
      hasPermission: false,
      checkedPermissions: required,
      missingPermissions: required.filter((entry) => entry !== permission),
    });
    expect(await service.read(target.id, req(), async () => dto())).toEqual(dto());
    expect(iam.loadPolicies).not.toHaveBeenCalled();
  });
  it("does not treat a missing legacy grant as authorization", async () => {
    env.security.iamAuthorizationMode = "legacy";
    permissions.checkUserPermissions.mockResolvedValue({
      hasPermission: false,
      checkedPermissions: required,
      missingPermissions: required,
    });
    const hydrate = vi.fn();
    await expect(service.read(target.id, req(), hydrate)).rejects.toMatchObject({ statusCode: 403 });
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("preserves a single legacy read and its 404 in shadow mode", async () => {
    env.security.iamAuthorizationMode = "shadow";
    iam.loadPolicies.mockRejectedValue(new Error("fixture unavailable"));
    const hydrate = vi.fn().mockResolvedValue(null);
    await expect(service.read(target.id, req(), hydrate)).rejects.toMatchObject({ statusCode: 404 });
    expect(hydrate).toHaveBeenCalledTimes(1);
  });
});
