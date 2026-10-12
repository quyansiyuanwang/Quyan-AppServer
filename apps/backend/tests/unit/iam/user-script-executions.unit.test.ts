import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { UserScriptExecutionRepository } from "@/store/user-script-execution.repository";
import type { UserScriptRepository } from "@/store/user-script.repository";
import type { UserScriptIamService } from "@/services/user-script/user-script-iam.service";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { TypedRequest } from "@/types/express";
vi.mock("@/store/user-script-execution.repository", () => ({
  UserScriptExecutionRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/user-script.repository", () => ({ UserScriptRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/user-script/user-script-iam.service", () => ({ UserScriptIamService: { getInstance: vi.fn() } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
import { UserScriptExecutionIamService } from "@/services/user-script/user-script-execution-iam.service";
import { userScriptExecutionSaveResourceResolver } from "@/iam/request/script-resource-resolvers";
import { UserScriptRepository as Repository } from "@/store/user-script.repository";
import { SCRIPT_EXECUTION_LIMITS } from "@/services/user-script/execution-limits";
import { createExecutionBodySchema } from "@/api/schema/user-script/user-script-execution.schema";
const repository = mockDeep<UserScriptExecutionRepository>(),
  scripts = mockDeep<UserScriptRepository>(),
  scriptIam = mockDeep<UserScriptIamService>(),
  iam = mockDeep<IamAuthorizationService>();
const Service = UserScriptExecutionIamService as unknown as new (
  repository: UserScriptExecutionRepository,
  scripts: UserScriptRepository,
  scriptIam: UserScriptIamService,
  iam: IamAuthorizationService,
) => UserScriptExecutionIamService;
const service = new Service(repository, scripts, scriptIam, iam);
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
    body: { scriptId: "script-1", accountId: "foreign" },
  }) as unknown as TypedRequest;
const target = (id: string, scriptId: string | null = null) => ({
  id,
  userId: "actor",
  scriptId,
  createTime: new Date("2026-10-12T00:00:00Z"),
});
const script = { id: "script-1", userId: "actor", createTime: new Date(), updateTime: new Date() };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(Repository.getInstance).mockReturnValue(scripts);
  scriptIam.identity.mockImplementation((_user, req) => ({ request: req!, principal }));
  scriptIam.filter.mockImplementation(async (_req, _principal, _action, resources) => [...resources]);
  iam.loadPolicies.mockResolvedValue([]);
  scripts.findTarget.mockResolvedValue(script);
  repository.scanTargets.mockResolvedValue([
    target("exec-3", "script-1"),
    target("exec-2"),
    target("exec-1", "script-1"),
  ]);
  repository.readTargets.mockImplementation(async (_user, _owner, targets) =>
    targets.map((row) => ({
      ...row,
      scriptName: "fixture",
      contentSnapshot: "private snapshot",
      output: "private output",
      durationMs: 1,
    })),
  );
});
describe("script execution resource authorization", () => {
  it("declares all history endpoints with registered server-owned actions", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const routes = collectIamRoutes(
      new Project({ skipAddingFilesFromTsConfig: true }).addSourceFilesAtPaths(
        root + "src/api/controllers/v1/user-script/user-script-execution.controller.ts",
      ),
      root,
    );
    expect(routes).toHaveLength(3);
    expect(routes.every((route) => route.coverage === "explicit" && route.issues.length === 0)).toBe(true);
  });
  it("keeps unlinked executions and only hydrates histories allowed on both execution and linked script", async () => {
    scriptIam.filter.mockImplementation(async (_req, _principal, _action, resources) =>
      resources.filter((resource) => !resource.endsWith("script-1")),
    );
    expect((await service.list("actor", request())).map((row) => row.id)).toEqual(["exec-2"]);
    expect(repository.readTargets).toHaveBeenCalledWith("actor", "owner", [target("exec-2")]);
  });
  it("rejects a denied individual execution even when its linked script is allowed", async () => {
    scriptIam.filter.mockImplementation(async (_req, _principal, _action, resources) =>
      resources.filter((resource) => !resource.endsWith("exec-3")),
    );
    expect((await service.list("actor", request())).map((row) => row.id)).toEqual(["exec-2", "exec-1"]);
  });
  it("scans beyond a fully denied batch before applying the visible record limit", async () => {
    const denied = Array.from({ length: SCRIPT_EXECUTION_LIMITS.metadataBatch }, (_, index) =>
      target("exec-" + String(1000 - index).padStart(4, "0")),
    );
    repository.scanTargets
      .mockResolvedValueOnce(denied)
      .mockResolvedValueOnce([target("exec-0002"), target("exec-0001")]);
    scriptIam.filter.mockImplementation(async (_req, _principal, _action, resources) =>
      resources.filter((resource) => resource.endsWith("exec-0001") || resource.endsWith("exec-0002")),
    );
    expect((await service.list("actor", request())).map((row) => row.id)).toEqual(["exec-0002", "exec-0001"]);
    expect(repository.scanTargets).toHaveBeenLastCalledWith("actor", "owner", undefined, denied.at(-1));
  });
  it("returns only the most recent 50 authorized records and hydrates no rejected history", async () => {
    const targets = Array.from({ length: 70 }, (_, index) => target("exec-" + String(100 - index).padStart(3, "0")));
    repository.scanTargets.mockResolvedValue(targets);
    scriptIam.filter.mockImplementation(async (_req, _principal, _action, resources) =>
      resources.filter((resource) => !resource.endsWith("exec-100")),
    );
    const rows = await service.list("actor", request());
    expect(rows).toHaveLength(50);
    expect(rows[0].id).toBe("exec-099");
    expect(rows.at(-1)?.id).toBe("exec-050");
  });
  it("requires owned script authorization for a script-specific list", async () => {
    scriptIam.authorizeTarget.mockRejectedValueOnce(new Error("denied"));
    await expect(service.list("actor", request(), "script-1")).rejects.toThrow("denied");
    expect(repository.scanTargets).not.toHaveBeenCalled();
  });
  it("fails closed for foreign targets malformed IDs and changed hydration metadata", async () => {
    repository.scanTargets.mockResolvedValue([{ ...target("exec-1"), userId: "foreign" }]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.scanTargets.mockResolvedValue([target("exec-1", "*")]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.scanTargets.mockResolvedValue([target("exec-1")]);
    repository.readTargets.mockResolvedValue([
      {
        ...target("exec-1", "another-script"),
        scriptName: "fixture",
        contentSnapshot: "private",
        output: "",
        durationMs: 1,
      },
    ]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks revocation before reading snapshots", async () => {
    scriptIam.filter.mockResolvedValueOnce(["acs:script:*:owner:execution/actor/exec-2"]).mockResolvedValueOnce([]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.readTargets).not.toHaveBeenCalled();
  });
  it("does not return hydrated snapshots after a mid-read grant revocation", async () => {
    repository.scanTargets.mockResolvedValue([target("exec-1")]);
    scriptIam.filter
      .mockResolvedValueOnce(["acs:script:*:owner:execution/actor/exec-1"])
      .mockResolvedValueOnce(["acs:script:*:owner:execution/actor/exec-1"])
      .mockResolvedValueOnce([]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.readTargets).toHaveBeenCalled();
  });
  it("requires both current user and linked script on save and permits an unlinked snapshot", async () => {
    await service.authorizeSave("actor", "script-1", request());
    expect(scriptIam.filter).toHaveBeenCalledWith(expect.anything(), principal, "quyan:script:SaveExecution", [
      "acs:quyan:*:owner:user/actor",
      "acs:script:*:owner:script/actor/script-1",
    ]);
    await service.authorizeSave("actor", undefined, request());
    expect(scriptIam.filter).toHaveBeenLastCalledWith(expect.anything(), principal, "quyan:script:SaveExecution", [
      "acs:quyan:*:owner:user/actor",
    ]);
    scriptIam.filter.mockResolvedValueOnce([]);
    await expect(service.authorizeSave("actor", "script-1", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not accept missing foreign or case-aliased script metadata", async () => {
    scripts.findTarget.mockResolvedValue({ ...script, userId: "other" });
    await expect(service.authorizeSave("actor", "script-1", request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(userScriptExecutionSaveResourceResolver({ request: request(), principal })).resolves.toBeUndefined();
    scripts.findTarget.mockResolvedValue({ ...script, id: "SCRIPT-1" });
    await expect(userScriptExecutionSaveResourceResolver({ request: request(), principal })).resolves.toBeUndefined();
  });
  it("rejects malformed association IDs and does not use client account IDs", async () => {
    expect(
      createExecutionBodySchema.safeParse({
        scriptId: "*",
        scriptName: "fixture",
        contentSnapshot: "fixture",
        output: "",
        durationMs: 0,
      }).success,
    ).toBe(false);
    expect(await userScriptExecutionSaveResourceResolver({ request: request(), principal })).toEqual([
      "acs:quyan:*:owner:user/actor",
      "acs:script:*:owner:script/actor/script-1",
    ]);
    const unlinked = request() as unknown as TypedRequest<Record<string, unknown>>;
    delete unlinked.body.scriptId;
    expect(await userScriptExecutionSaveResourceResolver({ request: unlinked, principal })).toEqual([
      "acs:quyan:*:owner:user/actor",
    ]);
  });
});
