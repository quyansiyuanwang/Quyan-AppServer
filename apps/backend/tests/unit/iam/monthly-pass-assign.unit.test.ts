import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
import { env } from "@/config/env";
import { getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { PlatformMonthlyPassAssignIamService } from "@/services/billing/platform-monthly-pass-assign-iam.service";
import { platformMonthlyPassAssignResources } from "@/iam/request/platform-monthly-pass-assign-resource-resolvers";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { platformMonthlyPassArn } from "@/iam/resources/platform-monthly-pass-resources";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode,
  action = "quyan:monthly_pass:AssignUserPass";
const iam = { loadPolicies: vi.fn(), authorize: vi.fn() },
  repository = {
    findAssignmentUser: vi.fn(),
    findTemplateById: vi.fn(),
    findLatestUserPassIdentity: vi.fn(),
    findUserPassById: vi.fn(),
  },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformMonthlyPassAssignIamService(iam, repository, snapshots, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "fake:*" },
    body: { userId: "customer", templateId: "template", accountId: "attacker" },
    secure: true,
    ip: "192.0.2.8",
  }) as unknown as TypedRequest;
const prepare = () => service.prepare("actor", request(), "customer", "template");
let denied: Set<string>;
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  denied = new Set();
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorize.mockImplementation(async ({ resource }) => ({
    decision: denied.has(resource) ? "ExplicitDeny" : "Allow",
    reason: "fixture",
    matchedStatements: [],
  }));
  repository.findAssignmentUser.mockResolvedValue({
    id: "customer",
    accountOwnerId: null,
    status: 1,
    updateTime: new Date(0),
  });
  repository.findTemplateById.mockResolvedValue({ id: "template", status: 1, quotaWindows: [] });
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
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("monthly pass assignment creation authorization", () => {
  it("declares the actual endpoint and composite resources", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/monthly-pass.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (route) => route.key === "POST /v1/monthly-passes/user-passes",
      ),
    ).toMatchObject({ coverage: "explicit", actions: [action], resourceKind: "batch" });
    expect(getIamActionDefinition(action)).toMatchObject({ authorizationBoundary: "platform" });
    expect(isIamActionResourceCompatible(action, platformMonthlyPassArn("customer", "pass"))).toBe(true);
  });
  it("uses only server Action metadata and validated business identifiers", async () => {
    const req = request();
    expect(
      await platformMonthlyPassAssignResources({ request: req, principal: { accountOwnerId: "owner" } as never }),
    ).toEqual([platformUserArn("customer"), platformTemplateArn("monthly-pass", "template")]);
    await prepare();
    expect(iam.authorize.mock.calls.every(([input]) => input.action === action)).toBe(true);
    (req.body as unknown as { userId: string }).userId = "../bad";
    expect(await platformMonthlyPassAssignResources({ request: req, principal: {} as never })).toBeUndefined();
  });
  it.each([platformUserArn("customer"), platformTemplateArn("monthly-pass", "template")])(
    "denies parent %s before hydrating assignment sources",
    async (resource) => {
      denied.add(resource);
      await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
      expect(repository.findAssignmentUser).not.toHaveBeenCalled();
      expect(repository.findTemplateById).not.toHaveBeenCalled();
    },
  );
  it("requires the generated assignment resource in the commit callback", async () => {
    const source = await prepare();
    denied.add(platformMonthlyPassArn("customer", "new-pass"));
    await expect(source!.guard.recheckEntry("new-pass")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects changed source snapshots and credentials", async () => {
    const source = await prepare();
    source!.guard.customer.accountOwnerId = "other";
    await expect(source!.guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepare("actor", undefined, "customer", "template")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("does not widen target scope when a database lookup returns another identity", async () => {
    repository.findAssignmentUser.mockResolvedValue({
      id: "other",
      accountOwnerId: null,
      status: 1,
      updateTime: new Date(0),
    });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("preserves legacy permission enforcement while shadow does not change legacy writes", async () => {
    env.security.iamAuthorizationMode = "legacy";
    expect(await prepare()).toBeUndefined();
    expect(iam.authorize).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(prepare()).rejects.toMatchObject({ statusCode: 403 });
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
    env.security.iamAuthorizationMode = "shadow";
    denied.add(platformUserArn("customer"));
    expect(await prepare()).toBeUndefined();
  });
});

describe("batch monthly pass authorization", () => {
  const batch = () => service.prepare("actor", request(), "customer", "template", "AssignUserPassBatch");
  it("registers its own Action rather than accepting a client Action", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/billing/monthly-pass.controller.ts");
    expect(
      collectIamRoutes(project.getSourceFiles(), process.cwd()).find(
        (route) => route.key === "POST /v1/monthly-passes/user-passes/batch",
      ),
    ).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:monthly_pass:AssignUserPassBatch"],
      resourceKind: "single-resource",
    });
    await batch();
    expect(iam.authorize.mock.calls.every(([input]) => input.action === "quyan:monthly_pass:AssignUserPassBatch")).toBe(
      true,
    );
  });
  it("requires a valid batch actor before enumerating targets", async () => {
    await expect(service.assertBatchActor("actor", undefined)).rejects.toMatchObject({ statusCode: 403 });
    snapshots.snapshot.mockRejectedValue(new Error("unavailable"));
    await expect(service.assertBatchActor("actor", request())).rejects.toThrow("unavailable");
  });
  it("does not hydrate an existing assignment denied by the batch Action", async () => {
    repository.findLatestUserPassIdentity.mockResolvedValue({ id: "pass", userId: "customer", status: 1 });
    const source = await batch();
    denied.add(platformMonthlyPassArn("customer", "pass"));
    await expect(service.prepareBatchExtension(source!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findUserPassById).not.toHaveBeenCalled();
  });
  it("rejects mismatched target identities", async () => {
    repository.findLatestUserPassIdentity.mockResolvedValue({ id: "pass", userId: "other", status: 1 });
    const source = await batch();
    await expect(service.prepareBatchExtension(source!.guard)).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.findUserPassById).not.toHaveBeenCalled();
  });
  it("does not accept a single-assignment guard for a batch extension", async () => {
    const source = await prepare();
    await expect(service.prepareBatchExtension(source!.guard)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains legacy authorization and shadow behavior", async () => {
    env.security.iamAuthorizationMode = "legacy";
    await service.assertBatchActor("actor", request());
    expect(await batch()).toBeUndefined();
    expect(iam.authorize).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.assertBatchActor("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
    env.security.iamAuthorizationMode = "shadow";
    denied.add(platformUserArn("customer"));
    expect(await batch()).toBeUndefined();
  });
});
