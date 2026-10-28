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
import type { AgentMachineTarget, PublicAgentMachine } from "@/store/agent/agent.repository";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { TypedRequest } from "@/types/express";
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
import { agentMachineResourceResolver } from "@/iam/request/agent-resource-resolvers";
import { AgentRepository } from "@/store/agent/agent.repository";
import { AgentMachineIamService } from "@/services/agent/agent-machine-iam.service";
const repository = mockDeep<AgentRepository>(),
  iam = mockDeep<IamAuthorizationService>();
const Service = AgentMachineIamService as unknown as new (
  repository: AgentRepository,
  iam: IamAuthorizationService,
) => AgentMachineIamService;
const service = new Service(repository, iam);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
    query: { accountId: "foreign" },
  }) as unknown as TypedRequest;
const target = (id: string): AgentMachineTarget => ({
  id,
  userId: "actor",
  createTime: new Date("2026-10-12T00:00:00Z"),
  updateTime: new Date("2026-10-12T00:00:00Z"),
});
const row = (target: AgentMachineTarget): PublicAgentMachine => ({
  ...target,
  status: 1,
  name: "fixture",
  runtime: "rootless-docker",
  runtimeStatus: "pending",
  agentId: null,
  capabilities: {},
  lastHeartbeatAt: null,
});
const allow: IamEvaluationResult = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny: IamEvaluationResult = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
beforeEach(() => {
  vi.resetAllMocks();
  iam.loadPolicies.mockResolvedValue([]);
  repository.findMachineTarget.mockResolvedValue(target("server-1"));
  repository.scanMachineTargets.mockResolvedValue([target("server-3"), target("server-2"), target("server-1")]);
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource) => (resource.endsWith("server-2") ? deny : allow)),
  );
  repository.readMachineTargets.mockImplementation(async (_user, _owner, targets) => targets.map(row));
});
describe("Agent machine resource authorization", () => {
  it("denies deletion of foreign or case-aliased metadata and a matching explicit Deny", async () => {
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    vi.mocked(AgentRepository.getInstance).mockReturnValue(repository);
    const req = request();
    req.params = { machineId: "server-1" };
    await expect(agentMachineResourceResolver({ request: req, principal })).resolves.toBe(
      "acs:agent:*:owner:machine/actor/server-1",
    );
    repository.findMachineTarget.mockResolvedValueOnce({ ...target("server-1"), userId: "other" });
    await expect(agentMachineResourceResolver({ request: req, principal })).resolves.toBeUndefined();
    repository.findMachineTarget.mockResolvedValueOnce(target("SERVER-1"));
    await expect(agentMachineResourceResolver({ request: req, principal })).resolves.toBeUndefined();
    iam.authorizeMany.mockResolvedValueOnce([deny]);
    await expect(service.authorizeTarget("server-1", "actor", req)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("declares both routes with migration aliases and no self-service defaults", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const routes = collectIamRoutes(
      new Project({ skipAddingFilesFromTsConfig: true }).addSourceFilesAtPaths(
        root + "src/api/controllers/v1/agent/agent.controller.ts",
      ),
      root,
    ).filter((route) => route.key.includes("/machines"));
    expect(routes).toHaveLength(3);
    expect(routes.every((route) => route.coverage === "explicit" && !route.issues.length)).toBe(true);
    expect(iamActionsForLegacyPermission(Permission.AGENT_WORKSPACE_READ)).toContain("quyan:agent:ListMachines");
    expect(getIamActionDefinition("quyan:agent:CreateMachine")?.resourceTypes).toEqual(["quyan/user"]);
    expect(IAM_AUTHENTICATED_SELF_ACTIONS).not.toContain("quyan:agent:ListMachines");
  });
  it("authorizes metadata before reading endpoints and never accepts a client account", async () => {
    expect((await service.list("actor", request())).map((row) => row.id)).toEqual(["server-3", "server-1"]);
    expect(repository.readMachineTargets).toHaveBeenCalledWith("actor", "owner", [
      target("server-3"),
      target("server-1"),
    ]);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:agent:ListMachines",
        resources: [
          "acs:agent:*:owner:machine/actor/server-3",
          "acs:agent:*:owner:machine/actor/server-2",
          "acs:agent:*:owner:machine/actor/server-1",
        ],
      }),
    );
  });
  it("rejects missing identity and impersonated caller IDs before reading storage", async () => {
    await expect(service.list("actor")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list("other", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.scanMachineTargets).not.toHaveBeenCalled();
  });
  it("does not load configuration when no record is allowed", async () => {
    iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => deny));
    await expect(service.list("actor", request())).resolves.toEqual([]);
    expect(repository.readMachineTargets).toHaveBeenCalledWith("actor", "owner", []);
  });
  it("fails closed for incomplete decisions repeated cursors and foreign metadata", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.scanMachineTargets.mockResolvedValueOnce([target("server-1"), target("server-1")]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.scanMachineTargets.mockResolvedValueOnce([{ ...target("server-1"), userId: "other" }]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects stale or substituted hydration and unexpected registration hashes", async () => {
    repository.readMachineTargets.mockResolvedValueOnce([row(target("server-2"))]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    repository.readMachineTargets.mockResolvedValueOnce([
      { ...row(target("server-1")), registrationHash: "fixture-hash" } as PublicAgentMachine,
      row(target("server-3")),
    ]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects revocations before hydration and after configuration is loaded", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow, deny, allow]).mockResolvedValueOnce([deny, deny]);
    await expect(service.list("actor", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.readMachineTargets).not.toHaveBeenCalled();
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
      expect.objectContaining({ action: "quyan:agent:CreateMachine", resources: ["acs:quyan:*:owner:user/actor"] }),
    );
  });
});
