import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/services/users/user.service", () => ({ UserService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: vi.fn() }), LogCategory: { SECURITY: "security" } }));
import { env } from "@/config/env";
import { PlatformUserReadIamService } from "@/services/users/platform-user-read-iam.service";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { userViewDto } from "@/services/users/user-view";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { where: vi.fn(), scan: vi.fn(), target: vi.fn(), recheck: vi.fn(), hydrate: vi.fn() },
  legacy = { getVisibleUsersPage: vi.fn(), getUserById: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() };
const service = new PlatformUserReadIamService(iam, snapshots, repository, legacy, permissions);
const request = () =>
  ({
    user: { userId: "actor", roleSessionId: "session" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*", "x-account-id": "forged" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const target = (id = "user", status = 1) => ({
  id,
  status,
  createTime: new Date(0),
  updateTime: new Date(0),
  revision: "a".repeat(64),
});
const view = (id: string, status = 1) => ({
  id,
  status,
  username: "fixture",
  email: "private@example.invalid",
  name: "fixture",
  accountOwnerId: null,
  groupId: "target-group",
  group: { name: "Target", username: "target" },
  balanceAccount: { balance: 5 },
  createTime: new Date(0),
  updateTime: new Date(0),
});
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({ group: { id: "global", updateTime: new Date(0) }, users: [] });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.where.mockResolvedValue({ level: 0, query: {} });
  repository.scan.mockResolvedValue([target("z"), target("a", 0)]);
  repository.target.mockResolvedValue(target());
  repository.recheck.mockResolvedValue(undefined);
  repository.hydrate.mockImplementation(async (_principal, targets: { id: string; status: number }[]) =>
    targets.map((row) => view(row.id, row.status)),
  );
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.getVisibleUsersPage.mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 20, hasMore: false });
  legacy.getUserById.mockResolvedValue({ id: "user" });
});
describe("platform user directory resource reads", () => {
  it("preserves disabled users and paginates authorized rows", async () => {
    const result = await service.list({ page: 2, pageSize: 1 }, request());
    expect(result).toMatchObject({
      total: 2,
      hasMore: false,
      users: [{ id: "a", status: 0, balance: 5, groupName: "Target" }],
    });
    expect(repository.hydrate.mock.calls[0]![1].map((row: { id: string }) => row.id)).toEqual(["a"]);
    expect(legacy.getVisibleUsersPage).not.toHaveBeenCalled();
  });
  it("does not hydrate or count denied users", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
      resources.map((resource) => ({
        decision: resource.endsWith("/z") ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    expect(await service.list({}, request())).toMatchObject({ total: 1, users: [{ id: "a" }] });
    expect(repository.hydrate.mock.calls[0]![1]).toHaveLength(1);
  });
  it("returns an empty authorized set without reading private content", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }: { resources: string[] }) =>
      resources.map(() => ({ decision: "ImplicitDeny", reason: "fixture", matchedStatements: [] })),
    );
    expect(await service.list({}, request())).toMatchObject({ total: 0, users: [] });
    expect(repository.hydrate.mock.calls[0]![1]).toEqual([]);
  });
  it("resolves detail from loaded target metadata and fixed action", async () => {
    expect(await service.detail("user", request())).toMatchObject({ id: "user", accountOwnerId: "user" });
    expect(
      iam.authorizeMany.mock.calls.every(
        ([input]) => input.action === "quyan:user:GetUser" && input.resources[0] === platformUserArn("user"),
      ),
    ).toBe(true);
  });
  it("denies detail before private DTO hydration", async () => {
    iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny", reason: "fixture", matchedStatements: [] }]);
    await expect(service.detail("user", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.hydrate).not.toHaveBeenCalled();
    expect(legacy.getUserById).not.toHaveBeenCalled();
  });
  it("retains existing RAM-user exclusion and trusted actor filtering", async () => {
    await service.list({ excludeCurrentUser: true }, request());
    expect(repository.where).toHaveBeenCalledWith(
      expect.objectContaining({ subjectUserId: "actor" }),
      expect.objectContaining({ excludeUserType: "ram_user", excludeUserId: "actor" }),
    );
    await service.list({ hasRamPermission: true }, request());
    expect(repository.where.mock.calls.at(-1)![1]).not.toHaveProperty("excludeUserType");
  });
  it("rejects status and malformed revision substitutions", async () => {
    repository.scan.mockResolvedValue([{ ...target(), status: -1 }]);
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
    repository.target.mockResolvedValue({ ...target(), revision: "malformed" });
    await expect(service.detail("user", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects content revisions changed after hydration", async () => {
    repository.scan.mockResolvedValueOnce([target()]).mockResolvedValue([{ ...target(), revision: "b".repeat(64) }]);
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects missing and mismatched target metadata", async () => {
    repository.target.mockResolvedValue(null);
    await expect(service.detail("user", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.target.mockResolvedValue(target("other"));
    await expect(service.detail("user", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects incomplete or non-finite view hydration", async () => {
    repository.hydrate.mockResolvedValue([]);
    await expect(service.detail("user", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.hydrate.mockResolvedValue([{ ...view("user"), balanceAccount: { balance: Infinity } }]);
    await expect(service.detail("user", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([{ page: 0 }, { pageSize: 101 }, { page: 10001 }, { userType: "unknown" }, { actorUserId: "forged" }])(
    "rejects invalid or client identity query %j",
    async (input) => {
      await expect(service.list(input as never, request())).rejects.toMatchObject({ statusCode: 400 });
      expect(repository.scan).not.toHaveBeenCalled();
    },
  );
  it.each(["legacy", "shadow"] as const)("retains session-aware legacy checks in %s", async (mode) => {
    env.security.iamAuthorizationMode = mode;
    iam.authorizeMany.mockRejectedValue(new Error("IAM unavailable"));
    expect((await service.list({}, request())).total).toBe(0);
    expect(await service.detail("user", request())).toEqual({ id: "user" });
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", ["user:read"], {
      assumedRoleSessionId: "session",
    });
    if (mode === "shadow") expect(repository.hydrate).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.detail("user", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects missing authentication, OAuth and unknown modes", async () => {
    await expect(service.list({}, {} as TypedRequest)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.detail("user", { ...request(), oauthAccessToken: {} } as TypedRequest)).rejects.toMatchObject({
      statusCode: 403,
    });
    env.security.iamAuthorizationMode = "invalid" as never;
    await expect(service.list({}, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("uses the authenticated role-session context for legacy permission checks", async () => {
    env.security.iamAuthorizationMode = "legacy";
    const req = request();
    req.authContext!.roleSessionId = "trusted-session";
    await service.list({}, req);
    expect(permissions.checkUserPermissions).toHaveBeenCalledWith("actor", ["user:read"], {
      assumedRoleSessionId: "trusted-session",
    });
  });
  it("uses a credential-free DTO mapper shared with legacy projections", () => {
    const dto = userViewDto(
      { ...view("user"), password: "fixture-secret" } as never,
      { balance: 5 },
      { name: "", username: "fallback" },
    );
    expect(dto).toMatchObject({ id: "user", groupName: "fallback", balance: 5 });
    expect(dto).not.toHaveProperty("password");
  });
  it("declares list and detail endpoints with fixed server actions", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      file = project.addSourceFileAtPath("src/api/controllers/v1/users/user.controller.ts"),
      routes = collectIamRoutes([file], process.cwd());
    expect(routes.find((row) => row.method === "getAllUsers")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:user:ListUsers"],
      resourceKind: "collection",
    });
    expect(routes.find((row) => row.method === "getUserById")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:user:GetUser"],
      resourceKind: "single-resource",
    });
  });
});
