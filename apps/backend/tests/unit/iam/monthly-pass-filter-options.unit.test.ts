import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/relay/relay-channel.service", () => ({ RelayChannelService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { Permission, isIamActionResourceCompatible } from "@quyan/shared";
import {
  MonthlyPassFilterOptionsIamService,
  monthlyPassFilterResource,
} from "@/services/billing/monthly-pass-filter-options-iam.service";
import { MONTHLY_PASS_FILTER_KINDS } from "@/store/billing/monthly-pass-filter-options.store";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:monthly_pass:GetFilterOptions",
  now = new Date(0);
const target = (kind: string) => ({ id: kind, status: 1, createTime: now, updateTime: now, revision: "a".repeat(64) });
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { scope: vi.fn(), scan: vi.fn(), hydrate: vi.fn(), verify: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  channels = { canAccessChannelOption: vi.fn() };
const service = new MonthlyPassFilterOptionsIamService(iam, repository, snapshots, permissions, channels);
const req = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "attacker:*" },
    secure: true,
    ip: "192.0.2.9",
  }) as unknown as TypedRequest;
const staticOptions = {
    templateStatusOptions: [],
    assignmentStatusOptions: [],
    publishStatusOptions: [],
    assignmentModeOptions: [],
    quotaUnitOptions: [],
  },
  legacy = vi.fn();
let denied: Set<string>;
const read = () => service.read("actor", req(), legacy, staticOptions);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  denied = new Set();
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource: string) => ({
      decision: denied.has(resource) ? "ExplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    })),
  );
  repository.scope.mockResolvedValue({ groupId: "global", minGroupLevel: 1 });
  repository.scan.mockImplementation(async (kind, _scope, after) => (after ? [] : [target(kind)]));
  repository.hydrate.mockImplementation(async (kind, _scope, rows) =>
    rows.map((row: { id: string }) => ({
      kind,
      id: row.id,
      status: 1,
      name: kind,
      username: kind,
      publishStatus: "draft",
      model: "model",
      visibilityMode: "public",
      visibilityConfig: null,
    })),
  );
  repository.verify.mockResolvedValue(undefined);
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: now }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  channels.canAccessChannelOption.mockResolvedValue(true);
  legacy.mockResolvedValue({ ...staticOptions, templates: [], models: ["legacy-only"], channels: [], groups: [] });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("monthly pass filter option authorization", () => {
  it("declares its server Action and every concrete option type", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/monthly-pass.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/monthly-passes/filter-options",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "collection" });
    for (const kind of MONTHLY_PASS_FILTER_KINDS)
      expect(isIamActionResourceCompatible(action, monthlyPassFilterResource(kind, "id"))).toBe(true);
    const result = await read();
    expect(result).toMatchObject({
      templates: [{ id: "template" }],
      models: ["model"],
      channels: [{ value: "channel" }],
      groups: [{ id: "group" }],
    });
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === action)).toBe(true);
  });
  it.each(MONTHLY_PASS_FILTER_KINDS)("does not hydrate a denied %s option", async (kind) => {
    denied.add(monthlyPassFilterResource(kind, kind));
    await read();
    expect(
      repository.hydrate.mock.calls.filter(([source]) => source === kind).every(([, , rows]) => rows.length === 0),
    ).toBe(true);
  });
  it("preserves channel visibility in addition to IAM", async () => {
    channels.canAccessChannelOption.mockResolvedValue(false);
    expect((await read()).channels).toEqual([]);
  });
  it("rejects changed source data across later option categories", async () => {
    repository.verify.mockRejectedValue(new Error("drift"));
    await expect(read()).rejects.toThrow("drift");
  });
  it("rejects a late channel visibility change", async () => {
    channels.canAccessChannelOption.mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires a current actor and platform management eligibility", async () => {
    await expect(service.read("actor", undefined, legacy, staticOptions)).rejects.toMatchObject({ statusCode: 403 });
    snapshots.snapshot.mockRejectedValue(new Error("not eligible"));
    await expect(read()).rejects.toThrow("not eligible");
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it("retains any-of legacy permissions and forwards role session context", async () => {
    env.security.iamAuthorizationMode = "legacy";
    permissions.checkUserPermissions.mockImplementation(async (_actor, [permission]) => ({
      hasPermission: permission === Permission.MONTHLY_PASS_USAGE_READ,
    }));
    expect((await read()).models).toEqual(["legacy-only"]);
    const scoped = req();
    scoped.authContext!.roleSessionId = "role-session";
    await service.read("actor", scoped, legacy, staticOptions);
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", [Permission.MONTHLY_PASS_USAGE_READ], {
      assumedRoleSessionId: "role-session",
    });
    expect(iam.authorizeMany).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("keeps shadow on the legacy response after recording native decisions", async () => {
    env.security.iamAuthorizationMode = "shadow";
    denied.add(monthlyPassFilterResource("template", "template"));
    expect((await read()).models).toEqual(["legacy-only"]);
    expect(iam.authorizeMany).toHaveBeenCalled();
  });
});
