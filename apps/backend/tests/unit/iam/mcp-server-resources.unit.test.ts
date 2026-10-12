import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import {
  IAM_AUTHENTICATED_SELF_ACTIONS,
  getIamActionDefinition,
  Permission,
  iamActionsForLegacyPermission,
} from "@quyan/shared";
import type { IamEvaluationResult } from "@quyan/shared";
import type { AgentRepository, McpServerTarget, PublicMcpServer } from "@/store/agent/agent.repository";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { TypedRequest } from "@/types/express";
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
import { McpServerIamService } from "@/services/agent/mcp-server-iam.service";
const repository = mockDeep<AgentRepository>(),
  iam = mockDeep<IamAuthorizationService>();
const Service = McpServerIamService as unknown as new (
  repository: AgentRepository,
  iam: IamAuthorizationService,
) => McpServerIamService;
const service = new Service(repository, iam);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
    query: { accountId: "foreign" },
  }) as unknown as TypedRequest;
const target = (id: string): McpServerTarget => ({
  id,
  userId: "actor",
  name: id,
  updateTime: new Date("2026-10-12T00:00:00Z"),
});
const row = (target: McpServerTarget): PublicMcpServer => ({
  ...target,
  status: 1,
  createTime: target.updateTime,
  transport: "sse",
  endpoint: "https://fixture.invalid/mcp",
  agentId: null,
  enabled: true,
  toolAllowlist: [],
  metadata: {},
  credential: { id: "credential-marker" },
});
const allow: IamEvaluationResult = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny: IamEvaluationResult = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
beforeEach(() => {
  vi.resetAllMocks();
  iam.loadPolicies.mockResolvedValue([]);
  repository.scanMcpTargets.mockResolvedValue([target("server-1"), target("server-2"), target("server-3")]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource) => (resource.endsWith("server-2") ? deny : allow)),
  );
  repository.readMcpTargets.mockImplementation(async (_user, _owner, targets) => targets.map(row));
});
describe("MCP server resource authorization", () => {
  it("declares both routes with migration aliases and no self-service defaults", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const routes = collectIamRoutes(
      new Project({ skipAddingFilesFromTsConfig: true }).addSourceFilesAtPaths(
        root + "src/api/controllers/v1/agent/agent.controller.ts",
      ),
      root,
    ).filter((route) => route.key.includes("/mcp-servers"));
    expect(routes).toHaveLength(2);
    expect(routes.every((route) => route.coverage === "explicit" && !route.issues.length)).toBe(true);
    expect(iamActionsForLegacyPermission(Permission.MCP_SERVER_READ)).toContain("quyan:mcp:ListServers");
    expect(getIamActionDefinition("quyan:mcp:CreateServer")?.resourceTypes).toEqual(["quyan/user"]);
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain("quyan:mcp:ListServers");
  });
  it("authorizes metadata before reading endpoints and never accepts a client account", async () => {
    expect((await service.list("actor", request())).map((row) => row.id)).toEqual(["server-1", "server-3"]);
    expect(repository.readMcpTargets).toHaveBeenCalledWith("actor", "owner", [target("server-1"), target("server-3")]);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:mcp:ListServers",
        resources: [
          "acs:mcp:*:owner:server/actor/server-1",
          "acs:mcp:*:owner:server/actor/server-2",
          "acs:mcp:*:owner:server/actor/server-3",
        ],
      }),
    );
  });
  it("rejects missing identity and impersonated caller IDs before reading storage", async () => {
    await expect(service.list("actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("other", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scanMcpTargets).not.toHaveBeenCalled();
  });
  it("does not load configuration when no record is allowed", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => deny));
    await expect(service.list("actor", request())).resolves.toEqual([]);
    expect(repository.readMcpTargets).toHaveBeenCalledWith("actor", "owner", []);
  });
  it("fails closed for incomplete decisions repeated cursors and foreign metadata", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.scanMcpTargets.mockResolvedValueOnce([target("server-1"), target("server-1")]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.scanMcpTargets.mockResolvedValueOnce([{ ...target("server-1"), userId: "other" }]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects stale or substituted hydration and unexpected credential payloads", async () => {
    repository.readMcpTargets.mockResolvedValueOnce([row(target("server-2"))]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.readMcpTargets.mockResolvedValueOnce([
      { ...row(target("server-1")), credential: { id: "marker", ciphertext: "fixture-only" } as never },
      row(target("server-3")),
    ]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects revocations before hydration and after configuration is loaded", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow, deny, allow]).mockResolvedValueOnce([deny, deny]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.readMcpTargets).not.toHaveBeenCalled();
    iam.authorizeMany.mockReset();
    iam.authorizeMany
      .mockResolvedValueOnce([allow, deny, allow])
      .mockResolvedValueOnce([allow, allow])
      .mockResolvedValueOnce([deny, deny]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("requires an explicit create grant on the current user and denies invalid principals", async () => {
    iam.authorizeMany.mockResolvedValueOnce([deny]);
    await expect(service.authorizeCreate("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.authorizeCreate("actor", request())).resolves.toMatchObject({ accountOwnerId: "owner" });
    expect(iam.authorizeMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "quyan:mcp:CreateServer", resources: ["acs:quyan:*:owner:user/actor"] }),
    );
  });
});
