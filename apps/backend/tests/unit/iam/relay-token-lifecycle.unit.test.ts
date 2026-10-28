import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/iam-access-key-authority", () => ({ captureIamAccessKeyRevision: vi.fn() }));
vi.mock("@/store/relay/relay-token-authority", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/relay/relay-token-authority")>()),
  captureRelayTokenAuthority: vi.fn(),
}));
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { env } from "@/config/env";
import { RelayTokenLifecycleIamService } from "@/services/relay/relay-token-lifecycle-iam.service";
import { RelayTokenMutationResponseRepository } from "@/store/relay/relay-token-mutation-response.repository";
import { captureRelayTokenAuthority, RELAY_TOKEN_AUTHORITY_REQUIREMENTS } from "@/store/relay/relay-token-authority";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
import type { Prisma } from "@prisma/client";
const mode = env.security.iamAuthorizationMode;
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = { snapshot: vi.fn(), tokenOwner: vi.fn(), candidates: vi.fn(), apply: vi.fn() },
  permissions = { checkUserPermissions: vi.fn() },
  responses = { read: vi.fn(), verify: vi.fn() },
  project = vi.fn(),
  legacy = vi.fn();
const service = new RelayTokenLifecycleIamService(iam, repository, permissions, responses);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:relay:RevealToken" },
    secure: true,
  }) as unknown as TypedRequest;
const execute = (
  operation: "toggle" | "refresh" = "toggle",
  req: TypedRequest | undefined = request(),
  targetUserId?: string,
) => service.execute(operation, "actor", "token", targetUserId, req, project, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  repository.snapshot.mockResolvedValue({ users: [] });
  vi.mocked(captureRelayTokenAuthority).mockResolvedValue({ users: [] });
  repository.tokenOwner.mockResolvedValue("actor");
  repository.candidates.mockResolvedValue([{ id: "token", userId: "actor", status: 1, updateTime: new Date(0) }]);
  repository.apply.mockImplementation(async (_targets, guard, _change, persist, response) => {
    await guard.recheck();
    await guard.authorize();
    const result = persist ? await response({}) : undefined;
    await guard.recheck();
    await guard.authorize();
    return { total: 1, affected: persist ? 1 : 0, ...(persist ? { response: result } : {}) };
  });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  responses.read.mockResolvedValue({ record: { id: "token" }, targets: [] });
  project.mockResolvedValue({ id: "token", status: 0 });
  legacy.mockResolvedValue({ id: "legacy" });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("atomic token state and credential lifecycle authorization", () => {
  it("declares fixed native actions and conditional response permissions", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((row) => row.key === "PATCH /v1/relay/tokens/{id}/toggle")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:relay:SetTokenStatus"],
      issues: [],
    });
    expect(routes.find((row) => row.key === "POST /v1/relay/tokens/{id}/refresh")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:relay:RefreshToken"],
      issues: [],
    });
    expect(getIamActionDefinition("quyan:relay:RefreshToken")!.conditionalActions).toEqual(
      expect.arrayContaining(["quyan:relay:GetToken", "quyan:relay:RevealToken", "quyan:relay:RefreshManagedToken"]),
    );
    expect(isIamActionResourceCompatible("quyan:relay:RefreshToken", relayTokenArn("owner", "actor", "token"))).toBe(
      true,
    );
    expect(isIamActionResourceCompatible("quyan:relay:RefreshToken", platformRelayTokenArn("actor", "token"))).toBe(
      false,
    );
  });
  it("legacy UPDATE permits refresh only within the actor's own token prefix", () => {
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_UPDATE], "owner", "actor")!;
    const decide = (resource: string) =>
      evaluatePolicies([{ policyId: "fixture", document }], { action: "quyan:relay:RefreshToken", resource }).decision;
    expect(decide(relayTokenArn("owner", "actor", "token"))).toBe("Allow");
    expect(decide(relayTokenArn("owner", "peer", "token"))).toBe("ImplicitDeny");
  });
  it("projects the native DTO inside the mutation callback instead of a post-commit public GET", async () => {
    expect(await execute()).toEqual({ id: "token", status: 0 });
    expect(repository.apply.mock.calls[0]![2]).toEqual({ kind: "toggle" });
    expect(responses.read).toHaveBeenCalledOnce();
    expect(responses.verify).toHaveBeenCalled();
    expect(project).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
    expect(captureRelayTokenAuthority).toHaveBeenCalledWith(expect.anything(), RELAY_TOKEN_AUTHORITY_REQUIREMENTS.read);
  });
  it("toggle can return metadata without credential disclosure", async () => {
    iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
      resources.map(() => ({
        decision: action.endsWith("RevealToken") ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    await execute();
    expect(responses.read.mock.calls[0]![4]).toBe(false);
    expect(repository.apply).toHaveBeenCalledOnce();
  });
  it.each(["GetToken", "RevealToken", "RefreshToken"])("requires %s before rotating a credential", async (denied) => {
    iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
      resources.map(() => ({
        decision: action.endsWith(denied) ? "ExplicitDeny" : "Allow",
        reason: "fixture",
        matchedStatements: [],
      })),
    );
    await expect(execute("refresh")).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.apply).not.toHaveBeenCalled();
    expect(responses.read).not.toHaveBeenCalled();
  });
  it("binds managed mutation, read and reveal to target platform resources", async () => {
    await execute("refresh", request(), "peer");
    const calls = iam.authorizeMany.mock.calls.map(([input]) => ({ action: input.action, resources: input.resources }));
    for (const action of ["RefreshManagedToken", "GetManagedToken"])
      expect(calls).toContainEqual({ action: "quyan:relay:" + action, resources: [platformUserArn("peer")] });
    expect(calls).toContainEqual({
      action: "quyan:relay:RevealManagedToken",
      resources: [platformRelayTokenArn("peer", "token")],
    });
    expect(calls).toContainEqual({ action: "quyan:relay:GetToken", resources: ["acs:quyan:*:owner:user/actor"] });
  });
  it.each(
    [
      [],
      [{ decision: "ExplicitDeny" }],
      [{ decision: "Allow" }, { decision: "Allow" }],
      [{ decision: "unexpected" }],
    ].map((outcomes) => ({ outcomes })),
  )("denies malformed or denied decision batches %j", async ({ outcomes }) => {
    iam.authorizeMany.mockResolvedValue(outcomes);
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.apply).not.toHaveBeenCalled();
  });
  it("discards a completed response if reveal changes during projection", async () => {
    project.mockImplementation(async () => {
      iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
        resources.map(() => ({
          decision: action.endsWith("RevealToken") ? "ExplicitDeny" : "Allow",
          reason: "fixture",
          matchedStatements: [],
        })),
      );
      return {};
    });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects identity rebinding during asynchronous proof reads", async () => {
    const req = request();
    project.mockImplementation(async () => {
      repository.snapshot.mockImplementation(async () => {
        req.authContext!.accountOwnerId = "foreign";
        return { users: [] };
      });
      return {};
    });
    await expect(execute("refresh", req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks AccessKey authority after projection", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: "key" } as TypedRequest["accessKey"];
    vi.mocked(captureIamAccessKeyRevision).mockResolvedValue("initial");
    project.mockImplementation(async () => {
      vi.mocked(captureIamAccessKeyRevision).mockResolvedValue("revoked");
      return {};
    });
    await expect(execute("refresh", req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("propagates projection failures through the rollback boundary", async () => {
    project.mockRejectedValue(new Error("fixture projection failed"));
    await expect(execute("refresh")).rejects.toThrow("fixture projection failed");
    expect(legacy).not.toHaveBeenCalled();
  });
  it("shadow never generates a native credential or hydrates a response and calls legacy once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    expect(await execute("refresh")).toEqual({ id: "legacy" });
    expect(repository.apply.mock.calls[0]![3]).toBe(false);
    expect(responses.read).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("legacy uses its old operation guard without native authority reads", async () => {
    env.security.iamAuthorizationMode = "legacy";
    await execute();
    expect(repository.snapshot).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(execute()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).toHaveBeenCalledOnce();
  });
});
describe("safe mutation response selection", () => {
  const repo = new RelayTokenMutationResponseRepository();
  const identity = {
    principal: {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    },
    userId: "actor",
    managed: false,
  };
  it("does not select credentials or member details without separate admission", async () => {
    const findFirst = vi.fn().mockResolvedValue({
        id: "token",
        userId: "actor",
        status: 0,
        updateTime: new Date(0),
        memberTokenConfigs: [{ tokenId: "member", enabled: true, priority: 0 }],
      }),
      findMany = vi.fn();
    const result = await repo.read(
      { relayToken: { findFirst, findMany } } as unknown as Prisma.TransactionClient,
      identity,
      "token",
      async () => ["ExplicitDeny"],
      false,
    );
    expect(result.record).not.toHaveProperty("token");
    expect(result.record.memberTokenConfigs).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledOnce();
    expect(findFirst.mock.calls[0]![0].select).not.toHaveProperty("token");
    expect(findFirst.mock.calls[0]![0].select).not.toHaveProperty("upstreamApiKey");
    expect(findFirst.mock.calls[0]![0].select).not.toHaveProperty("legacyToken");
  });
});
