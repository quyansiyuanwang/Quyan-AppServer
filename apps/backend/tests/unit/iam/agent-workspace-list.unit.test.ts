import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
import type { IamEvaluationResult } from "@quyan/shared";
import type { AgentRepository, AgentWorkspaceTarget, PublicAgentWorkspace } from "@/store/agent/agent.repository";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { TypedRequest } from "@/types/express";
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
import { AgentWorkspaceIamService } from "@/services/agent/agent-workspace-iam.service";
import { agentWorkspaceArn } from "@/iam/resources/agent-resources";
const repository = mockDeep<AgentRepository>(),
  iam = mockDeep<IamAuthorizationService>();
const Service = AgentWorkspaceIamService as unknown as new (
  repository: AgentRepository,
  iam: IamAuthorizationService,
) => AgentWorkspaceIamService;
const service = new Service(repository, iam);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
    query: { accountId: "foreign" },
  }) as unknown as TypedRequest;
const target = (id: string, machineId: string | null = null): AgentWorkspaceTarget => ({
  id,
  userId: "actor",
  machineId,
  createTime: new Date(1),
  updateTime: new Date(1),
});
const row = (target: AgentWorkspaceTarget): PublicAgentWorkspace => ({
  ...target,
  status: 1,
  name: "fixture",
  runtime: "rootless-docker",
  runtimeStatus: "pending",
  policy: {},
  limits: {},
});
const allow: IamEvaluationResult = { decision: "Allow", reason: "matched-allow", matchedStatements: [] };
const deny: IamEvaluationResult = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
beforeEach(() => {
  vi.resetAllMocks();
  iam.loadPolicies.mockResolvedValue([]);
  repository.scanWorkspaceTargets.mockResolvedValue([
    target("workspace-3"),
    target("workspace-2"),
    target("workspace-1"),
  ]);
  repository.readWorkspaceTargets.mockImplementation(async (_user, _owner, targets) => targets.map(row));
  repository.readMachineSummaries.mockResolvedValue([]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource) => (resource.endsWith("workspace-2") ? deny : allow)),
  );
});
describe("Agent workspace list resource authorization", () => {
  it("registers a production resource and an explicit list route with legacy mapping", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const route = collectIamRoutes(
      new Project({ skipAddingFilesFromTsConfig: true }).addSourceFilesAtPaths(
        root + "src/api/controllers/v1/agent/agent.controller.ts",
      ),
      root,
    ).find((route) => route.key === "GET /v1/agent/workspaces")!;
    expect(route.coverage).toBe("explicit");
    expect(route.issues).toEqual([]);
    expect(getIamActionDefinition("quyan:agent:ListWorkspaces")?.resourceTypes).toContain("agent/workspace");
    expect(iamActionsForLegacyPermission(Permission.AGENT_WORKSPACE_READ)).toContain("quyan:agent:ListWorkspaces");
    expect(agentWorkspaceArn("owner", "actor", "workspace-1")).toBe("acs:agent:*:owner:workspace/actor/workspace-1");
  });
  it("authorizes before loading policy and limits, and passes the trusted account", async () => {
    expect((await service.list("actor", request())).map((row) => row.id)).toEqual(["workspace-3", "workspace-1"]);
    expect(repository.readWorkspaceTargets).toHaveBeenCalledWith("actor", "owner", [
      target("workspace-3"),
      target("workspace-1"),
    ]);
    expect(iam.authorizeMany.mock.invocationCallOrder[0]).toBeLessThan(
      repository.readWorkspaceTargets.mock.invocationCallOrder[0],
    );
  });
  it("does not load denied workspace bodies or machine labels", async () => {
    iam.authorizeMany.mockResolvedValue([deny, deny, deny]);
    expect(await service.list("actor", request())).toEqual([]);
    expect(repository.readWorkspaceTargets).toHaveBeenCalledWith("actor", "owner", []);
    expect(repository.readMachineSummaries).not.toHaveBeenCalled();
  });
  it("loads machine labels only for separately authorized machines", async () => {
    repository.scanWorkspaceTargets.mockResolvedValue([
      target("workspace-3", "machine-3"),
      target("workspace-1", "machine-1"),
    ]);
    iam.authorizeMany.mockImplementation(async ({ action, resources }) =>
      resources.map((resource) =>
        action === "quyan:agent:ListMachines" && resource.endsWith("machine-1") ? deny : allow,
      ),
    );
    repository.readMachineSummaries.mockResolvedValue([
      { id: "machine-3", userId: "actor", name: "allowed", runtimeStatus: "online" },
    ]);
    const rows = await service.list("actor", request());
    expect(repository.readMachineSummaries).toHaveBeenCalledWith("actor", "owner", ["machine-3"]);
    expect(rows[0].machine?.name).toBe("allowed");
    expect(rows[1].machine).toBeNull();
  });
  it("fails closed without trusted identity, with mixed ownership or malformed cursor data", async () => {
    await expect(service.list("actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("other", request())).rejects.toMatchObject({ statusCode: 403 });
    for (const bad of [
      { ...target("workspace-1"), userId: "foreign" },
      target("../bad"),
      target("valid", "bad/path"),
    ]) {
      repository.scanWorkspaceTargets.mockResolvedValueOnce([bad]);
      await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    }
    repository.scanWorkspaceTargets.mockResolvedValueOnce([target("same"), target("same")]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.readWorkspaceTargets).not.toHaveBeenCalled();
  });
  it("rejects incomplete policy decisions and invalid authorized snapshots", async () => {
    iam.authorizeMany.mockResolvedValueOnce([]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.readWorkspaceTargets.mockResolvedValueOnce([row(target("workspace-3"))]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.readWorkspaceTargets.mockResolvedValueOnce([
      row(target("workspace-3")),
      { ...row(target("workspace-1")), runtimeHandle: "private" } as PublicAgentWorkspace,
    ]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks workspace and machine authorization before returning any result", async () => {
    iam.authorizeMany
      .mockResolvedValueOnce([allow, deny, allow])
      .mockResolvedValueOnce([allow, allow])
      .mockResolvedValueOnce([deny, allow]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.scanWorkspaceTargets.mockResolvedValue([target("workspace-3", "machine-3")]);
    iam.authorizeMany
      .mockReset()
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([allow])
      .mockResolvedValueOnce([deny]);
    repository.readMachineSummaries.mockResolvedValue([
      { id: "machine-3", userId: "actor", name: "fixture", runtimeStatus: "online" },
    ]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects leaked or foreign machine summaries", async () => {
    repository.scanWorkspaceTargets.mockResolvedValue([target("workspace-3", "machine-3")]);
    repository.readMachineSummaries.mockResolvedValue([
      { id: "machine-3", userId: "other", name: "private", runtimeStatus: "online" },
    ]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
