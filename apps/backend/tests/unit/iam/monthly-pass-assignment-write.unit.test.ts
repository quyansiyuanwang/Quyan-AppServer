import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import {
  IAM_MONTHLY_PASS_ASSIGNMENT_WRITE_OPERATIONS,
  getIamActionDefinition,
  isIamActionResourceCompatible,
} from "@quyan/shared";
import { PlatformMonthlyPassAssignmentWriteIamService } from "@/services/billing/platform-monthly-pass-assignment-write-iam.service";
import { platformMonthlyPassArn } from "@/iam/resources/platform-monthly-pass-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { monthlyPassAssignmentRevision } from "@/store/billing/monthly-pass-assignment-write";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
import type { UserMonthlyPassWithTemplate } from "@/store/billing/monthly-pass.store";
const originalMode = env.security.iamAuthorizationMode;
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { findUserPassIdentity: vi.fn(), findUserPassById: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformMonthlyPassAssignmentWriteIamService(iam, repository, snapshots, permissions);
const record = {
  id: "pass",
  userId: "customer",
  templateId: "template",
  status: 1,
  startAt: new Date(0),
  endAt: new Date(100000),
  totalQuota: 100,
  usedQuota: 10,
  remainingQuota: 90,
  createTime: new Date(0),
  updateTime: new Date(0),
  quotaWindows: [],
  user: { username: "fixture customer" },
  template: { name: "fixture template" },
} as unknown as UserMonthlyPassWithTemplate;
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    ip: "192.0.2.1",
    secure: true,
  }) as unknown as TypedRequest;
let denied: Set<string>;
const prepare = (deleteViaUpdate = false) =>
  service.prepare("UpdateUserPass", "actor", request(), "pass", deleteViaUpdate);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  denied = new Set();
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
    resources.map((resource: string) => ({
      decision: denied.has(action + "|" + resource) ? "ExplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    })),
  );
  repository.findUserPassIdentity.mockResolvedValue({ id: "pass", userId: "customer", status: 1 });
  repository.findUserPassById.mockResolvedValue(record);
  snapshots.snapshot.mockResolvedValue({
    group: { id: "global", updateTime: new Date(0) },
    users: [
      { id: "actor", updateTime: new Date(0) },
      { id: "owner", updateTime: new Date(0) },
    ],
  });
  snapshots.recheck.mockResolvedValue(undefined);
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = originalMode;
  vi.restoreAllMocks();
});
describe("monthly pass assignment write authorization", () => {
  it("registers both native mutation endpoints and the delete variant", () => {
    const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/monthly-pass.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const definition of IAM_MONTHLY_PASS_ASSIGNMENT_WRITE_OPERATIONS) {
      const action = "quyan:monthly_pass:" + definition.operation;
      expect(getIamActionDefinition(action)).toMatchObject({ authorizationBoundary: "platform" });
      expect(isIamActionResourceCompatible(action, platformMonthlyPassArn("customer", "pass"))).toBe(true);
      expect(routes.find((route) => route.key === definition.route)).toMatchObject({
        coverage: "explicit",
        actions: [action],
      });
    }
    expect(getIamActionDefinition("quyan:monthly_pass:UpdateUserPass")?.conditionalActions).toContain(
      "quyan:monthly_pass:DeleteUserPass",
    );
  });
  it("signs a guard from the trusted identity and retains the server Action", async () => {
    const prepared = await prepare();
    expect(prepared?.guard).toMatchObject({
      operation: "UpdateUserPass",
      target: { record: { id: "pass", userId: "customer" } },
      response: { username: true, template: true },
    });
    expect(iam.authorizeMany.mock.calls.every(([input]) => input.action === "quyan:monthly_pass:UpdateUserPass")).toBe(
      true,
    );
  });
  it("denies before loading full assignment content", async () => {
    denied.add("quyan:monthly_pass:UpdateUserPass|" + platformMonthlyPassArn("customer", "pass"));
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findUserPassById).not.toHaveBeenCalled();
  });
  it("requires DeleteUserPass in addition to UpdateUserPass for deletion", async () => {
    denied.add("quyan:monthly_pass:DeleteUserPass|" + platformMonthlyPassArn("customer", "pass"));
    await expect(prepare(true)).rejects.toMatchObject({ statusCode: 403 });
    expect((await prepare())?.guard.deleteViaUpdate).toBe(false);
  });
  it("withholds username and template display contributions separately", async () => {
    denied.add("quyan:monthly_pass:UpdateUserPass|" + platformUserArn("customer"));
    denied.add("quyan:monthly_pass:UpdateUserPass|" + platformTemplateArn("monthly-pass", "template"));
    expect((await prepare())?.guard.response).toEqual({ username: false, template: false });
  });
  it("rechecks primary and projection decisions on transaction callbacks", async () => {
    const source = await prepare();
    denied.add("quyan:monthly_pass:UpdateUserPass|" + platformTemplateArn("monthly-pass", "template"));
    await expect(source!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a retargeted record after the minimal identity was resolved", async () => {
    repository.findUserPassById.mockResolvedValue({ ...record, userId: "other" });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects missing request, wrong actor and unsafe resource identifiers in enforce", async () => {
    await expect(service.prepare("UpdateUserPass", "actor", undefined, "pass")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.prepare("UpdateUserPass", "other", request(), "pass")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.prepare("UpdateUserPass", "actor", request(), "../pass")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("retains legacy permission enforcement and isolated shadow checks", async () => {
    env.security.iamAuthorizationMode = "legacy";
    expect(await prepare()).toBeUndefined();
    expect(repository.findUserPassById).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
    env.security.iamAuthorizationMode = "shadow";
    denied.add("quyan:monthly_pass:UpdateUserPass|" + platformMonthlyPassArn("customer", "pass"));
    expect(await prepare()).toBeUndefined();
  });
  it("detects consumed quota and window changes without depending on timestamps", () => {
    const revision = monthlyPassAssignmentRevision(record);
    expect(monthlyPassAssignmentRevision({ ...record, usedQuota: 11 as any })).not.toBe(revision);
    expect(
      monthlyPassAssignmentRevision({ ...record, quotaWindows: [{ id: "window", quotaLimit: 10 } as any] }),
    ).not.toBe(revision);
    expect(monthlyPassAssignmentRevision({ ...record, template: { name: "another display name" } })).toBe(revision);
  });
});
