import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/services/system/config.service", () => ({ ConfigService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { TerminalPersonalUnbindIamService } from "@/services/remote-terminal/terminal-personal-unbind-iam.service";
import { terminalPersonalUnbindResource } from "@/iam/request/terminal-personal-unbind-resource-resolver";
import {
  remoteTerminalProductBindingArn,
  remoteTerminalProductEntitlementArn,
} from "@/iam/resources/remote-terminal-resources";
import {
  IAM_AUTHENTICATED_SELF_ACTIONS,
  getIamActionDefinition,
  isIamActionResourceCompatible,
  Permission,
  type IamPrincipal,
} from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { authorize: vi.fn(), loadPolicies: vi.fn() },
  repository = { target: vi.fn(), run: vi.fn() },
  users = { targets: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  config = { getRemoteTerminalUnbindConfig: vi.fn() };
const service = new TerminalPersonalUnbindIamService(iam, repository, users, permissions, config);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake", "x-account-id": "other" },
    ip: "192.0.2.42",
    secure: true,
    params: { id: "binding" },
    body: { userId: "other" },
  }) as unknown as TypedRequest;
const mode = env.security.iamAuthorizationMode;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "fixture", matchedStatements: [] });
  repository.target.mockResolvedValue({
    id: "binding",
    userId: "actor",
    entitlementId: "entitlement",
    label: "fixture",
    status: 1,
    updateTime: new Date(0),
    unbindResetAt: null,
    entitlementUpdateTime: new Date(0),
    entitlementStatus: 1,
    revision: "a".repeat(64),
  });
  users.targets.mockResolvedValue([
    { id: "actor", updateTime: new Date(0) },
    { id: "owner", updateTime: new Date(0) },
  ]);
  config.getRemoteTerminalUnbindConfig.mockResolvedValue({ maxCount: 2, windowHours: 24, rebindCooldownMinutes: 60 });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("personal device unbind resource authority", () => {
  it("registers actual child-resource routes and gives only reminder reads a self-service baseline", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const [method, suffix, operation] of [
      ["DELETE", "", "RevokeMyDeviceBinding"],
      ["GET", "/unbind-reminder", "GetMyUnbindReminder"],
    ]) {
      const action = "quyan:remote_terminal:" + operation;
      expect(
        routes.find((route) => route.key === method + " /v1/remote-terminal/products/me/devices/{id}" + suffix),
      ).toMatchObject({ coverage: "explicit", actions: [action], issues: [] });
      expect(isIamActionResourceCompatible(action, remoteTerminalProductBindingArn("owner", "actor", "binding"))).toBe(
        true,
      );
      expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:user/actor")).toBe(false);
    }
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).toContain("quyan:remote_terminal:GetMyUnbindReminder");
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain("quyan:remote_terminal:RevokeMyDeviceBinding");
    expect(getIamActionDefinition("quyan:remote_terminal:RevokeMyDeviceBinding")?.legacyPermissions).toEqual([
      Permission.REMOTE_TERMINAL_DEVICE_READ,
      Permission.REMOTE_TERMINAL_SESSION_CREATE,
      Permission.REMOTE_TERMINAL_SESSION_READ,
    ]);
  });
  it.each(["RevokeMyDeviceBinding", "GetMyUnbindReminder"] as const)(
    "requires both binding and quota-parent authority for %s",
    async (operation) => {
      const source = await service.prepare(operation, "actor", "binding", request());
      expect(source?.guard.operation).toBe(operation);
      expect(iam.authorize.mock.calls.map(([entry]) => entry.resource)).toContain(
        remoteTerminalProductEntitlementArn("owner", "actor", "entitlement"),
      );
      expect(iam.authorize.mock.calls[0][0]).toMatchObject({
        action: "quyan:remote_terminal:" + operation,
        resource: remoteTerminalProductBindingArn("owner", "actor", "binding"),
      });
      expect(iam.authorize.mock.invocationCallOrder[0]).toBeLessThan(repository.target.mock.invocationCallOrder[0]!);
    },
  );
  it("refuses binding denial before loading any metadata", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] });
    await expect(service.prepare("RevokeMyDeviceBinding", "actor", "binding", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.target).not.toHaveBeenCalled();
  });
  it("refuses parent denial before querying quota counts", async () => {
    iam.authorize.mockImplementation(async ({ resource }) => ({
      decision: resource.includes("product-entitlement/") ? "ExplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    }));
    await expect(service.prepare("GetMyUnbindReminder", "actor", "binding", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.run).not.toHaveBeenCalled();
  });
  it("refuses ownership mismatches, spoofed subjects and malformed identifiers", async () => {
    repository.target.mockResolvedValue({ id: "binding", userId: "other" });
    await expect(service.prepare("GetMyUnbindReminder", "actor", "binding", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.prepare("GetMyUnbindReminder", "other", "binding", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.prepare("GetMyUnbindReminder", "actor", "../binding", request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("refuses quota configuration changes before commit", async () => {
    const source = await service.prepare("RevokeMyDeviceBinding", "actor", "binding", request());
    config.getRemoteTerminalUnbindConfig.mockResolvedValue({ maxCount: 0, windowHours: 24, rebindCooldownMinutes: 60 });
    await expect(source!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("refuses permission data failures and fresh request-condition denial", async () => {
    const source = await service.prepare("RevokeMyDeviceBinding", "actor", "binding", request());
    iam.authorize.mockResolvedValue({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] });
    await expect(source!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
    iam.loadPolicies.mockRejectedValue(new Error("fixture unavailable"));
    await expect(source!.guard.users.recheck()).rejects.toThrow("fixture unavailable");
  });
  it.each(["legacy", "shadow"] as const)("preserves any-permission enforcement in %s", async (value) => {
    env.security.iamAuthorizationMode = value;
    iam.authorize.mockRejectedValue(new Error("fixture unavailable"));
    permissions.checkUserPermissions.mockImplementation(async (_user, values) => ({
      hasPermission: values[0] === Permission.REMOTE_TERMINAL_SESSION_READ,
    }));
    expect(await service.prepare("RevokeMyDeviceBinding", "actor", "binding", request())).toBeUndefined();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.prepare("RevokeMyDeviceBinding", "actor", "binding", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await service.prepare("GetMyUnbindReminder", "actor", "binding", request())).toBeUndefined();
  });
  it("requires trusted identity and known rollout mode", async () => {
    await expect(service.prepare("RevokeMyDeviceBinding", "actor", "binding")).rejects.toMatchObject({
      statusCode: 403,
    });
    env.security.iamAuthorizationMode = "invalid" as typeof env.security.iamAuthorizationMode;
    await expect(service.prepare("RevokeMyDeviceBinding", "actor", "binding", request())).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("resolves only the authenticated user regardless of client ownership fields", async () => {
    const context = {
      request: request(),
      principal: {
        subjectUserId: "actor",
        principalUserId: "actor",
        accountOwnerId: "owner",
        subjectType: "sub_user",
      } as IamPrincipal,
    };
    expect(await terminalPersonalUnbindResource(context)).toBe(
      remoteTerminalProductBindingArn("owner", "actor", "binding"),
    );
    context.request.params.id = "bad/id";
    expect(await terminalPersonalUnbindResource(context)).toBeUndefined();
  });
});
