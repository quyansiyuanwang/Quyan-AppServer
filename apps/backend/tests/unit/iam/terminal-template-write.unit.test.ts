import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { PlatformTerminalTemplateWriteIamService } from "@/services/remote-terminal/platform-terminal-template-write-iam.service";
import { platformTemplateArn, platformTerminalTemplateControlArn } from "@/iam/resources/platform-template-resources";
import { platformTerminalTemplateWriteResource } from "@/iam/request/platform-terminal-template-write-resource-resolvers";
import {
  IAM_REMOTE_TERMINAL_TEMPLATE_WRITE_OPERATIONS,
  getIamActionDefinition,
  isIamActionResourceCompatible,
  Permission,
} from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const iam = { authorize: vi.fn(), loadPolicies: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { target: vi.fn(), create: vi.fn(), mutate: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformTerminalTemplateWriteIamService(iam, repository, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "client:Fake", "x-account-id": "other" },
    ip: "192.0.2.42",
    secure: true,
    params: { id: "template" },
    body: { accountId: "other" },
  }) as unknown as TypedRequest;
const mode = env.security.iamAuthorizationMode;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockResolvedValue({ decision: "Allow", reason: "fixture", matchedStatements: [] });
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.target.mockResolvedValue({
    record: { id: "template", name: "Fixture", status: 1 },
    revision: "a".repeat(64),
  });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("terminal template write authority", () => {
  it("registers real write routes and keeps delete-via-update visible in the catalog", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/remote-terminal/remote-terminal-product.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const entry of IAM_REMOTE_TERMINAL_TEMPLATE_WRITE_OPERATIONS) {
      const action = "quyan:remote_terminal:" + entry.operation;
      expect(routes.find((route) => route.key === entry.route)).toMatchObject({
        coverage: "explicit",
        actions: [action],
        issues: [],
      });
      expect(getIamActionDefinition(action)).toMatchObject({
        authorizationBoundary: "platform",
        legacyPermission: Permission.REMOTE_TERMINAL_PRODUCT_WRITE,
      });
      expect(isIamActionResourceCompatible(action, platformTemplateArn("remote-terminal", "template"))).toBe(true);
      expect(isIamActionResourceCompatible(action, "acs:quyan:*:owner:user/actor")).toBe(false);
    }
    expect(getIamActionDefinition("quyan:remote_terminal:UpdateTemplate")?.conditionalActions).toContain(
      "quyan:remote_terminal:DeleteTemplate",
    );
  });
  it("checks create authority against both the control and generated resource", async () => {
    const result = await service.prepare("CreateTemplate", "actor", request());
    await result!.guard.recheckEntry("new-template");
    expect(iam.authorize.mock.calls.some(([input]) => input.resource === platformTerminalTemplateControlArn())).toBe(
      true,
    );
    expect(
      iam.authorize.mock.calls.some(
        ([input]) => input.resource === platformTemplateArn("remote-terminal", "new-template"),
      ),
    ).toBe(true);
    expect(repository.target).not.toHaveBeenCalled();
  });
  it.each(["UpdateTemplate", "PublishTemplate", "UnpublishTemplate", "DeleteTemplate"] as const)(
    "uses the fixed %s action before fetching mutation data",
    async (operation) => {
      const result = await service.prepare(operation, "actor", request(), "template");
      expect(result?.target?.record.id).toBe("template");
      expect(iam.authorize.mock.calls[0][0]).toMatchObject({
        action: "quyan:remote_terminal:" + operation,
        resource: platformTemplateArn("remote-terminal", "template"),
        context: { "acs:SourceIp": "192.0.2.42" },
      });
      expect(iam.authorize.mock.invocationCallOrder[0]).toBeLessThan(repository.target.mock.invocationCallOrder[0]!);
    },
  );
  it("rejects Deny before loading the template and never invokes legacy persistence", async () => {
    iam.authorize.mockResolvedValue({ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] });
    await expect(service.prepare("UpdateTemplate", "actor", request(), "template")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.target).not.toHaveBeenCalled();
    expect(repository.mutate).not.toHaveBeenCalled();
  });
  it("requires separate DeleteTemplate authority for status -1 in an update", async () => {
    iam.authorize.mockImplementation(async (input) => ({
      decision: input.action.endsWith(":DeleteTemplate") ? "ImplicitDeny" : "Allow",
      reason: "fixture",
      matchedStatements: [],
    }));
    await expect(service.prepare("UpdateTemplate", "actor", request(), "template", true)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.target).not.toHaveBeenCalled();
  });
  it("keeps checking native policy and identity revisions through the write guard", async () => {
    const result = await service.prepare("UpdateTemplate", "actor", request(), "template");
    iam.loadPolicies.mockResolvedValue([
      { policyId: "revoked", document: { Version: "1", Statement: { Effect: "Deny", Action: "*", Resource: "*" } } },
    ]);
    await expect(result!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects revocation or policy lookup failure during final resource admission", async () => {
    const result = await service.prepare("CreateTemplate", "actor", request());
    iam.authorize.mockResolvedValue({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] });
    await expect(result!.guard.recheckEntry("new-template")).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["legacy", "shadow"] as const)(
    "preserves %s legacy enforcement when native diagnosis fails",
    async (mode) => {
      env.security.iamAuthorizationMode = mode;
      iam.authorize.mockRejectedValue(new Error("unavailable"));
      expect(await service.prepare("UpdateTemplate", "actor", request(), "template")).toBeUndefined();
      expect(permissions.checkUserPermissions).toHaveBeenCalledWith(
        "actor",
        [Permission.REMOTE_TERMINAL_PRODUCT_WRITE],
        expect.anything(),
      );
    },
  );
  it("rejects failed legacy enforcement even in shadow", async () => {
    env.security.iamAuthorizationMode = "shadow";
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.prepare("UpdateTemplate", "actor", request(), "template")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("rejects untrusted actor and missing request in enforce", async () => {
    await expect(service.prepare("UpdateTemplate", "other", request(), "template")).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.prepare("CreateTemplate", "actor")).rejects.toMatchObject({ statusCode: 403 });
    expect(iam.authorize).not.toHaveBeenCalled();
  });
  it("cannot choose the action or platform account from client input", async () => {
    const req = request();
    expect(
      await platformTerminalTemplateWriteResource({
        request: req,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBe(platformTemplateArn("remote-terminal", "template"));
    req.params.id = "../other";
    expect(
      await platformTerminalTemplateWriteResource({
        request: req,
        principal: {
          subjectUserId: "actor",
          principalUserId: "actor",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
      }),
    ).toBeUndefined();
  });
});
