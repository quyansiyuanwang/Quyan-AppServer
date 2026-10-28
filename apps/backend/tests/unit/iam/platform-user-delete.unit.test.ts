vi.mock("@/util/logger", () => ({ getLogger: () => ({ warn: vi.fn() }), LogCategory: { SECURITY: "security" } }));
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-management-read.repository", () => ({
  PlatformManagementReadRepository: { getInstance: vi.fn() },
}));
import { PlatformUserDeleteIamService } from "@/services/users/platform-user-delete-iam.service";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  snapshots = { snapshot: vi.fn(), recheck: vi.fn() },
  repository = { target: vi.fn(), authorizationRevision: vi.fn(), recheck: vi.fn(), remove: vi.fn() },
  service = new PlatformUserDeleteIamService(iam, snapshots, repository);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:user:UpdateUser" },
    secure: true,
    ip: "192.0.2.20",
  }) as unknown as TypedRequest;
const target = () => ({
  resource: { id: "target", status: 0, updateTime: new Date(0), createTime: new Date(0), revision: "a".repeat(64) },
  username: "Target",
  groupId: "target-group",
  actorLevel: 1,
  targetLevel: 2,
});
beforeEach(() => {
  vi.resetAllMocks();
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  snapshots.snapshot.mockResolvedValue({
    group: { id: "global", updateTime: new Date(0) },
    users: [
      { id: "actor", updateTime: new Date(0) },
      { id: "owner", updateTime: new Date(0) },
    ],
  });
  snapshots.recheck.mockResolvedValue(undefined);
  repository.target.mockResolvedValue(target());
  repository.authorizationRevision.mockResolvedValue("b".repeat(64));
  repository.recheck.mockResolvedValue(undefined);
  repository.remove.mockImplementation(async (guard) => {
    await guard.users.recheck();
    return { id: guard.target.resource.id, username: guard.target.username };
  });
});
describe("platform user deletion grant", () => {
  it("passes one fixed target ARN and a live authorization guard to the repository", async () => {
    expect(await service.execute("target", "actor", request())).toEqual({ id: "target", username: "Target" });
    expect(repository.remove.mock.calls[0]![0]).toMatchObject({
      action: "quyan:user:DeleteUser",
      target: target(),
      authorizationRevision: "b".repeat(64),
    });
    for (const [input] of iam.authorizeMany.mock.calls)
      expect(input).toMatchObject({ action: "quyan:user:DeleteUser", resources: [platformUserArn("target")] });
  });
  it.each(["ExplicitDeny", "ImplicitDeny"])("does not delete after %s", async (decision) => {
    iam.authorizeMany.mockResolvedValue([{ decision, reason: "fixture", matchedStatements: [] }]);
    await expect(service.execute("target", "actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.remove).not.toHaveBeenCalled();
  });
  it("propagates unavailable authorization instead of invoking a legacy delete", async () => {
    iam.loadPolicies.mockRejectedValue(new Error("unavailable"));
    await expect(service.execute("target", "actor", request())).rejects.toThrow("unavailable");
    expect(repository.remove).not.toHaveBeenCalled();
  });
  it.each(["actor", "owner", "invalid/*"])("rejects protected or invalid target %s", async (id) => {
    await expect(service.execute(id, "actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.target).not.toHaveBeenCalled();
  });
  it("rejects missing and mismatched authentication or an OAuth context", async () => {
    await expect(service.execute("target", "actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.execute("target", "other", request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service.execute("target", "actor", { ...request(), oauthAccessToken: { id: "oauth" } } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a repository snapshot for a different user", async () => {
    repository.target.mockResolvedValue({ ...target(), resource: { ...target().resource, id: "other" } });
    await expect(service.execute("target", "actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(iam.authorizeMany).not.toHaveBeenCalled();
  });
  it("performs shadow checks without executing a second deletion", async () => {
    expect(await service.execute("target", "actor", request(), false)).toBeUndefined();
    expect(repository.remove).not.toHaveBeenCalled();
    expect(repository.recheck).toHaveBeenCalled();
  });
  it("detects a changed target during shadow comparison", async () => {
    repository.recheck.mockRejectedValue(new Error("target changed"));
    await expect(service.execute("target", "actor", request(), false)).rejects.toThrow("target changed");
    expect(repository.remove).not.toHaveBeenCalled();
  });
  it("rechecks account authorization revision during the final write guard", async () => {
    repository.remove.mockImplementation(async (guard) => {
      repository.authorizationRevision.mockResolvedValue("c".repeat(64));
      await guard.users.recheck();
    });
    await expect(service.execute("target", "actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains authenticated role context in the delete guard", async () => {
    const req = request();
    req.authContext!.roleSessionId = "session";
    req.authContext!.assumedRoleId = "role";
    await service.execute("target", "actor", req);
    expect(repository.remove.mock.calls[0]![0].users.principal).toMatchObject({
      roleSessionId: "session",
      assumedRoleId: "role",
      subjectType: "assumed_role",
    });
  });
  it("declares the controller delete action with a server resolver", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true }),
      file = project.addSourceFileAtPath("src/api/controllers/v1/users/user.controller.ts");
    expect(collectIamRoutes([file], process.cwd()).find((row) => row.method === "deleteUser")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:user:DeleteUser"],
      resourceKind: "single-resource",
    });
  });
});
