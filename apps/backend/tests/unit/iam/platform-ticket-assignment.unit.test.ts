import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/util/logger", () => ({ LogCategory: { SECURITY: "security" }, getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/ticket/ticket.service", () => ({ TicketService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/system/businesslog.service", () => ({ default: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformTicketAssignmentIamService } from "@/services/ticket/platform-ticket-assignment-iam.service";
import { platformTicketAssignmentArn } from "@/iam/resources/platform-ticket-assignment-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { target: vi.fn(), hydrate: vi.fn(), authorizationRevision: vi.fn(), update: vi.fn() },
  legacy = { getAssignmentConfig: vi.fn(), updateAssignmentConfig: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  logs = { logOperation: vi.fn() };
const service = new PlatformTicketAssignmentIamService(iam, snapshots, repository, legacy, permissions, logs);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const target = () => ({
  id: "config",
  status: 1,
  createTime: new Date(0),
  updateTime: new Date(0),
  revision: "a".repeat(64),
});
const rules = () => ({ rules: [{ type: "bug" as const, assigneeUserIds: ["reviewer", "reviewer"] }] });
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.target.mockImplementation(async () => target());
  repository.hydrate.mockResolvedValue(JSON.stringify(rules().rules));
  repository.authorizationRevision.mockResolvedValue("a".repeat(64));
  repository.update.mockImplementation(async (_value, _target, guard) => {
    await guard.users.recheck();
  });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.getAssignmentConfig.mockResolvedValue({ rules: [] });
  legacy.updateAssignmentConfig.mockResolvedValue({ rules: [] });
  logs.logOperation.mockResolvedValue(undefined);
});
describe("ticket assignment rule authorization", () => {
  it("authorizes a fixed logical resource and normalizes stored rules", async () => {
    expect(await service.read(request())).toEqual({ rules: [{ type: "bug", assigneeUserIds: ["reviewer"] }] });
    expect(
      iam.authorizeMany.mock.calls.every(
        ([input]) =>
          input.action === "quyan:ticket:GetAssignmentRules" && input.resources[0] === platformTicketAssignmentArn(),
      ),
    ).toBe(true);
  });
  it("returns default empty rules without initializing a missing configuration", async () => {
    repository.target.mockResolvedValue(null);
    repository.hydrate.mockResolvedValue(null);
    expect(await service.read(request())).toEqual({ rules: [] });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("rejects Deny before configuration metadata hydration", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] }]);
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
    expect(repository.hydrate).not.toHaveBeenCalled();
  });
  it.each(["{bad", "{}", '[{"type":"unknown","assigneeUserIds":["reviewer"]}]', "null"])(
    "rejects malformed stored configuration %j",
    async (raw) => {
      repository.hydrate.mockResolvedValue(raw);
      await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    },
  );
  it("rejects preserved-timestamp content changes before release", async () => {
    repository.target.mockResolvedValueOnce(target()).mockResolvedValue({ ...target(), revision: "b".repeat(64) });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("persists normalized rules through a transaction guard and audits counts", async () => {
    await service.update(rules(), request());
    expect(repository.update.mock.calls[0]![0]).toBe(JSON.stringify([{ type: "bug", assigneeUserIds: ["reviewer"] }]));
    expect(logs.logOperation.mock.calls[0]![0].changes).toMatchObject({ ruleCount: 1, assigneeCount: 1 });
    expect(JSON.stringify(logs.logOperation.mock.calls)).not.toContain('"assigneeUserIds"');
  });
  it("checks authorization revision inside the write guard", async () => {
    repository.authorizationRevision.mockResolvedValueOnce("a".repeat(64)).mockResolvedValue("b".repeat(64));
    await expect(service.update(rules(), request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not run a post-commit check that turns successful saves into denied responses", async () => {
    repository.update.mockImplementation(async (_value, _target, guard) => {
      await guard.users.recheck();
      iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] }]);
    });
    expect(await service.update(rules(), request())).toEqual({
      rules: [{ type: "bug", assigneeUserIds: ["reviewer"] }],
    });
  });
  it.each(["legacy", "shadow"] as const)("retains old read/write permission checks in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.read(request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.update(rules(), request())).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy.getAssignmentConfig).not.toHaveBeenCalled();
    expect(legacy.updateAssignmentConfig).not.toHaveBeenCalled();
  });
  it("shadow performs no second write", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await service.update(rules(), request());
    expect(legacy.updateAssignmentConfig).toHaveBeenCalledOnce();
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("validates input before any native mutation", async () => {
    await expect(service.update({ rules: [{ assigneeUserIds: [] }] }, request())).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
  it("fails closed on a missing request identity", async () => {
    await expect(service.read({} as TypedRequest)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses fixed route actions and preserves write replay protection", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const source = project.addSourceFileAtPath("src/api/controllers/v1/ticket/ticket.controller.ts");
    const routes = collectIamRoutes([source], process.cwd());
    expect(routes.find((row) => row.method === "getReviewAssignmentRules")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:ticket:GetAssignmentRules"],
    });
    expect(routes.find((row) => row.method === "setReviewAssignmentRules")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:ticket:UpdateAssignmentRules"],
    });
    expect(source.getClassOrThrow("TicketController").getMethodOrThrow("setReviewAssignmentRules").getText()).toContain(
      "replayProtectionMiddleware",
    );
  });
});
