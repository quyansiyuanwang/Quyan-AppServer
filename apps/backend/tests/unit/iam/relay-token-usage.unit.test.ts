import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/users/iam-access-key-authority", () => ({ captureIamAccessKeyRevision: vi.fn() }));
import { Project } from "ts-morph";
import { Permission, getIamActionDefinition, isIamActionResourceCompatible } from "@quyan/shared";
import { relayTokenUsageSummaryQuerySchema } from "@/api/schema/relay/relay.schema";
import { env } from "@/config/env";
import { RelayTokenInspectionIamService } from "@/services/relay/relay-token-inspection-iam.service";
import { captureIamAccessKeyRevision } from "@/store/users/iam-access-key-authority";
import { RELAY_TOKEN_AUTHORITY_REQUIREMENTS } from "@/store/relay/relay-token-authority";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
import { platformUserArn } from "@/iam/resources/platform-user-resources";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const mode = env.security.iamAuthorizationMode;
const iam = { loadPolicies: vi.fn(), authorizeMany: vi.fn() },
  repository = {
    snapshot: vi.fn(),
    tokenOwner: vi.fn(),
    target: vi.fn(),
    assertTarget: vi.fn(),
    list: vi.fn(),
    assertTargets: vi.fn(),
    switchLogs: vi.fn(),
  },
  permissions = { checkUserPermissions: vi.fn() },
  legacy = vi.fn();
const service = new RelayTokenInspectionIamService(iam, repository, permissions);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "quyan:relay:RevealToken" },
    secure: true,
  }) as unknown as TypedRequest;
const project = vi.fn();
const read = (req: TypedRequest | undefined = request(), targetUserId?: string) =>
  service.usage("actor", "token", targetUserId, req, project, legacy);
beforeEach(() => {
  vi.resetAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  iam.loadPolicies.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map(() => ({ decision: "Allow", reason: "fixture", matchedStatements: [] })),
  );
  repository.snapshot.mockResolvedValue({ users: [] });
  repository.tokenOwner.mockResolvedValue("actor");
  repository.target.mockResolvedValue({ id: "token", userId: "actor", status: 1, updateTime: new Date(0) });
  project.mockResolvedValue({ totalTokens: 4 });
  permissions.checkUserPermissions.mockResolvedValue({ hasPermission: true });
  legacy.mockResolvedValue({ total: 1, affected: 1 });
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
});
describe("token usage inspection authorization", () => {
  it("declares server-owned action at both usage endpoints", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    for (const key of ["GET /v1/relay/tokens/{id}/usage", "GET /v1/relay/tokens/{id}/usage-summary"])
      expect(routes.find((route) => route.key === key)).toMatchObject({
        coverage: "explicit",
        actions: ["quyan:relay:GetTokenUsage"],
        issues: [],
      });
    expect(getIamActionDefinition("quyan:relay:GetManagedTokenUsage")).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_READ,
    });
    expect(isIamActionResourceCompatible("quyan:relay:GetTokenUsage", relayTokenArn("owner", "actor", "token"))).toBe(
      true,
    );
    expect(isIamActionResourceCompatible("quyan:relay:GetTokenUsage", platformRelayTokenArn("peer", "token"))).toBe(
      false,
    );
  });
  it("restricts legacy usage access to own tokens", () => {
    const document = legacyPermissionsToPrincipalPolicy([Permission.RELAY_TOKEN_READ], "owner", "actor")!;
    const decide = (resource: string) =>
      evaluatePolicies([{ policyId: "fixture", document }], { action: "quyan:relay:GetTokenUsage", resource }).decision;
    expect(decide(relayTokenArn("owner", "actor", "token"))).toBe("Allow");
    expect(decide(relayTokenArn("owner", "peer", "token"))).toBe("ImplicitDeny");
  });
  it("uses read operation ceilings but does not require GetToken or RevealToken", async () => {
    expect(RELAY_TOKEN_AUTHORITY_REQUIREMENTS.read.operationPermission).toBe(Permission.RELAY_TOKEN_READ);
    expect(await read()).toEqual({ totalTokens: 4 });
    expect(project).toHaveBeenCalledOnce();
    expect(new Set(iam.authorizeMany.mock.calls.map(([input]) => input.action))).toEqual(
      new Set(["quyan:relay:GetTokenUsage"]),
    );
    expect(repository.assertTarget).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });
  it("requires personal admission and both managed platform user/token decisions", async () => {
    await read(request(), "peer");
    const calls = iam.authorizeMany.mock.calls.map(([input]) => ({ action: input.action, resources: input.resources }));
    expect(calls).toContainEqual({ action: "quyan:relay:GetTokenUsage", resources: ["acs:quyan:*:owner:user/actor"] });
    expect(calls).toContainEqual({ action: "quyan:relay:GetManagedTokenUsage", resources: [platformUserArn("peer")] });
    expect(calls).toContainEqual({
      action: "quyan:relay:GetManagedTokenUsage",
      resources: [platformRelayTokenArn("peer", "token")],
    });
  });
  it.each(
    [
      [],
      [{ decision: "ExplicitDeny" }],
      [{ decision: "unexpected" }],
      [{ decision: "Allow" }, { decision: "Allow" }],
    ].map((outcomes) => ({ outcomes })),
  )("denies invalid decision batches %j before projection", async ({ outcomes }) => {
    iam.authorizeMany.mockResolvedValue(outcomes);
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(project).not.toHaveBeenCalled();
  });
  it("discards a completed usage projection when its final decision is revoked", async () => {
    project.mockImplementation(async () => {
      iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny" }]);
      return { totalTokens: 4 };
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(project).toHaveBeenCalledOnce();
  });
  it("discards projections when token metadata changes", async () => {
    repository.assertTarget.mockRejectedValue({ statusCode: 403 });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks immutable request bindings after asynchronous authority reads", async () => {
    const req = request();
    project.mockImplementation(async () => {
      repository.snapshot.mockImplementation(async () => {
        req.authContext!.accountOwnerId = "foreign";
        return { users: [] };
      });
      return {};
    });
    await expect(read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("discards projections on AccessKey revision changes", async () => {
    const req = request();
    req.authContext!.subjectType = "access_key";
    req.accessKey = { id: "key" } as TypedRequest["accessKey"];
    vi.mocked(captureIamAccessKeyRevision).mockResolvedValue("initial");
    project.mockImplementation(async () => {
      vi.mocked(captureIamAccessKeyRevision).mockResolvedValue("revoked");
      return {};
    });
    await expect(read(req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks policies even if they still return Allow", async () => {
    project.mockImplementation(async () => {
      iam.loadPolicies.mockResolvedValue([
        {
          policyId: "new",
          document: {
            Version: "1",
            Statement: [{ Effect: "Allow", Action: ["quyan:relay:GetTokenUsage"], Resource: ["*"] }],
          },
        },
      ]);
      return {};
    });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires authenticated request context in enforce", async () => {
    await expect(read({} as TypedRequest)).rejects.toMatchObject({ statusCode: 403 });
    expect(project).not.toHaveBeenCalled();
  });
  it("shadow inspects metadata only then executes legacy once", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await read();
    expect(project).not.toHaveBeenCalled();
    expect(repository.target).toHaveBeenCalledOnce();
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("legacy avoids native reads while retaining the old permission ceiling", async () => {
    env.security.iamAuthorizationMode = "legacy";
    await read();
    expect(repository.target).not.toHaveBeenCalled();
    permissions.checkUserPermissions.mockResolvedValue({ hasPermission: false });
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
    expect(legacy).toHaveBeenCalledOnce();
  });
  it("enforce never falls back to legacy after native read failure", async () => {
    repository.target.mockRejectedValue(new Error("fixture unavailable"));
    await expect(read()).rejects.toThrow("fixture unavailable");
    expect(legacy).not.toHaveBeenCalled();
  });
});

describe("batch usage and switch inspection admission", () => {
  const summaries = (ids: string[] | undefined = undefined, req = request()) =>
    service.summaries("actor", ids, undefined, req, project, legacy);
  const logs = (req = request(), targetUserId?: string) =>
    service.switchLogs("actor", "token", targetUserId, req, project, legacy);
  it("declares batch usage and switch logs independently of credential access", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((row) => row.key === "GET /v1/relay/tokens/usage-summaries")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:relay:GetTokenUsage"],
      issues: [],
    });
    expect(routes.find((row) => row.key === "GET /v1/relay/tokens/{id}/switch-logs")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:relay:GetTokenSwitchLogs"],
      issues: [],
    });
    expect(getIamActionDefinition("quyan:relay:GetManagedTokenSwitchLogs")).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_READ,
    });
  });
  it("keeps batch selection order and checks every original decision again before release", async () => {
    repository.list.mockImplementation(async (userId, ids, decide) => {
      expect(userId).toBe("actor");
      expect(ids).toEqual(["second", "first"]);
      await decide(ids);
      return [{ id: "second" }, { id: "first" }];
    });
    await summaries(["second", "first"]);
    expect(project).toHaveBeenCalledWith([{ id: "second" }, { id: "first" }]);
    expect(repository.assertTargets).toHaveBeenCalledTimes(2);
    expect(iam.authorizeMany).toHaveBeenCalledTimes(2);
  });
  it("discards batch projections if a contributing decision changes", async () => {
    repository.list.mockImplementation(async (_userId, _ids, decide) => {
      await decide(["token"]);
      return [{ id: "token" }];
    });
    project.mockImplementation(async () => {
      iam.authorizeMany.mockResolvedValue([{ decision: "ExplicitDeny" }]);
      return {};
    });
    await expect(summaries()).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not query a single-token owner for a list scope", async () => {
    repository.list.mockResolvedValue([]);
    await summaries();
    expect(repository.tokenOwner).not.toHaveBeenCalled();
    expect(project).toHaveBeenCalledWith([]);
  });
  it.each(
    [[], ["same", "same"], ["../token"], Array.from({ length: 201 }, (_, i) => "id" + i)].map((ids) => ({ ids })),
  )("rejects invalid explicit selections %j before any policy query", async ({ ids }) => {
    await expect(summaries(ids)).rejects.toMatchObject({ statusCode: 400 });
    expect(iam.loadPolicies).not.toHaveBeenCalled();
  });
  it.each(["", ",", "one,", "one,,two", "one, one", Array.from({ length: 201 }, (_, i) => "id" + i).join(",")])(
    "rejects ambiguous or oversized comma-separated IDs %j",
    (tokenIds) => {
      expect(relayTokenUsageSummaryQuerySchema.safeParse({ tokenIds }).success).toBe(false);
    },
  );
  it("accepts omitted IDs and canonicalizes whitespace only through the shared ID schema", () => {
    expect(relayTokenUsageSummaryQuerySchema.safeParse({}).success).toBe(true);
    expect(relayTokenUsageSummaryQuerySchema.safeParse({ tokenIds: "one, two" }).success).toBe(true);
  });
  it("uses fixed switch-log Action even when the client forges one", async () => {
    await logs();
    expect(new Set(iam.authorizeMany.mock.calls.map(([input]) => input.action))).toEqual(
      new Set(["quyan:relay:GetTokenSwitchLogs"]),
    );
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.assertTarget).toHaveBeenCalled();
  });
  it("managed switch logs require user and token platform grants", async () => {
    await logs(request(), "peer");
    const calls = iam.authorizeMany.mock.calls.map(([input]) => ({ action: input.action, resources: input.resources }));
    expect(calls).toContainEqual({
      action: "quyan:relay:GetManagedTokenSwitchLogs",
      resources: [platformUserArn("peer")],
    });
    expect(calls).toContainEqual({
      action: "quyan:relay:GetManagedTokenSwitchLogs",
      resources: [platformRelayTokenArn("peer", "token")],
    });
  });
  it("switch-log shadow mode never invokes its native data projection", async () => {
    env.security.iamAuthorizationMode = "shadow";
    await logs();
    expect(project).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledOnce();
  });
});

describe("candidate collection admission through the common inspection guard", () => {
  it("evaluates a fixed candidate Action without borrowing usage or Reveal permissions", async () => {
    repository.list.mockImplementation(async (_owner, _ids, decide) => {
      await decide(["token"]);
      return [];
    });
    await service.candidates("actor", undefined, request(), async () => [], legacy);
    expect(new Set(iam.authorizeMany.mock.calls.map(([input]) => input.action))).toEqual(
      new Set(["quyan:relay:ListTokenCompositionCandidates"]),
    );
  });
  it("uses personal admission plus managed user and token boundaries for peers", async () => {
    repository.list.mockImplementation(async (_owner, _ids, decide) => {
      await decide(["token"]);
      return [];
    });
    await service.candidates("actor", "peer", request(), async () => [], legacy);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:relay:ListManagedTokenCompositionCandidates",
        resources: [platformUserArn("peer")],
      }),
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:relay:ListManagedTokenCompositionCandidates",
        resources: [platformRelayTokenArn("peer", "token")],
      }),
    );
  });
  it("shadow never invokes graph or candidate projection", async () => {
    env.security.iamAuthorizationMode = "shadow";
    repository.list.mockResolvedValue([]);
    const graph = vi.fn();
    await service.candidates("actor", undefined, request(), graph, legacy);
    expect(graph).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledTimes(1);
  });
});
