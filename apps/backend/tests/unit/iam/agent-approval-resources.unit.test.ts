import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import { getIamActionDefinition, getIamResourceType, Permission, iamActionsForLegacyPermission } from "@quyan/shared";
import type { IamEvaluationResult } from "@quyan/shared";
import type { AgentApprovalTarget } from "@/store/agent/agent.repository";
import type { AgentTaskIamService } from "@/services/agent/agent-task-iam.service";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { TypedRequest } from "@/types/express";
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/services/agent/agent-task-iam.service", () => ({ AgentTaskIamService: { getInstance: vi.fn() } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
import { AgentApprovalIamService } from "@/services/agent/agent-approval-iam.service";
import { AgentRepository } from "@/store/agent/agent.repository";
import { agentApprovalResourcesResolver } from "@/iam/request/agent-resource-resolvers";
const repository = mockDeep<AgentRepository>(),
  taskIam = mockDeep<AgentTaskIamService>(),
  iam = mockDeep<IamAuthorizationService>();
const Service = AgentApprovalIamService as unknown as new (
  repository: AgentRepository,
  taskIam: AgentTaskIamService,
  iam: IamAuthorizationService,
) => AgentApprovalIamService;
const service = new Service(repository, taskIam, iam);
const principal = {
  subjectUserId: "actor",
  principalUserId: "actor",
  accountOwnerId: "owner",
  subjectType: "sub_user" as const,
};
const task = {
  id: "task",
  userId: "actor",
  workspaceId: "workspace",
  taskStatus: "waiting_approval",
  updateTime: new Date(1),
};
const target = (id: string): AgentApprovalTarget => ({
  id,
  taskId: "task",
  stepId: "step-" + id,
  createTime: new Date(1),
  expiresAt: new Date(Date.now() + 60_000),
});
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: {},
    params: { taskId: "task", approvalId: "approval-1" },
  }) as unknown as TypedRequest;
const allow: IamEvaluationResult = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny: IamEvaluationResult = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
let targets: AgentApprovalTarget[];
beforeEach(() => {
  vi.resetAllMocks();
  targets = [target("approval-1"), target("approval-2")];
  taskIam.authorize.mockResolvedValue({ target: task, principal });
  repository.findTaskTarget.mockResolvedValue(task);
  repository.scanApprovalTargets.mockResolvedValue(targets);
  repository.findApprovalTarget.mockResolvedValue(targets[0]);
  repository.readApprovalTargets.mockImplementation(async (_task, _owner, selected) =>
    selected.map((target) => ({
      id: target.id,
      taskId: "task",
      status: "pending",
      toolCall: { command: "private" },
      expiresAt: target.expiresAt,
    })),
  );
  iam.authorizeMany.mockImplementation(async ({ resources }) =>
    resources.map((resource) => (resource.endsWith("approval-2") ? deny : allow)),
  );
  vi.mocked(AgentRepository.getInstance).mockReturnValue(repository);
});
describe("Agent approval resource authorization", () => {
  it("declares approval actions and produces both trusted task and approval resources", async () => {
    expect(getIamResourceType("acs:agent:*:owner:approval/actor/task/approval-1")?.arnTemplate).toBe(
      "acs:agent:*:{accountId}:approval/{ancestorId}/{parentId}/{resourceId}",
    );
    expect(getIamActionDefinition("quyan:agent:DecideApproval")?.resourceTypes).toEqual([
      "agent/task",
      "agent/approval",
    ]);
    expect(iamActionsForLegacyPermission(Permission.AGENT_APPROVAL)).toContain("quyan:agent:GetApproval");
    expect(await agentApprovalResourcesResolver({ request: request(), principal })).toEqual([
      "acs:agent:*:owner:task/actor/task",
      "acs:agent:*:owner:approval/actor/task/approval-1",
    ]);
    repository.findApprovalTarget.mockResolvedValueOnce({ ...targets[0], taskId: "foreign" });
    expect(await agentApprovalResourcesResolver({ request: request(), principal })).toBeUndefined();
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const routes = collectIamRoutes(
      new Project({ skipAddingFilesFromTsConfig: true }).addSourceFilesAtPaths(
        root + "src/api/controllers/v1/agent/agent.controller.ts",
      ),
      root,
    ).filter((route) => route.key.includes("/approvals"));
    expect(routes).toHaveLength(2);
    expect(routes.every((route) => route.coverage === "explicit" && !route.issues.length)).toBe(true);
  });
  it("loads tool calls only after per-approval authorization and filters explicit Deny", async () => {
    const rows = await service.list("actor", "task", request());
    expect(rows.map((row) => row.id)).toEqual(["approval-1"]);
    expect(repository.readApprovalTargets).toHaveBeenCalledWith(task, "owner", [targets[0]]);
    expect(iam.authorizeMany.mock.invocationCallOrder[0]).toBeLessThan(
      repository.readApprovalTargets.mock.invocationCallOrder[0],
    );
    expect(taskIam.authorize).toHaveBeenCalledWith("task", "actor", "quyan:agent:ListTaskApprovals", expect.anything());
  });
  it("rejects missing identity, foreign or duplicate metadata before payload reads", async () => {
    await expect(service.list("actor", "task")).rejects.toMatchObject({ statusCode: 403 });
    for (const selected of [[{ ...targets[0], taskId: "foreign" }], [targets[0], targets[0]]]) {
      repository.scanApprovalTargets.mockResolvedValueOnce(selected);
      await expect(service.list("actor", "task", request())).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(repository.readApprovalTargets).not.toHaveBeenCalled();
  });
  it("fails closed for stale payloads and revoked final permissions", async () => {
    repository.readApprovalTargets.mockResolvedValueOnce([]);
    await expect(service.list("actor", "task", request())).rejects.toMatchObject({ statusCode: 403 });
    iam.authorizeMany.mockResolvedValueOnce([allow, deny]).mockResolvedValueOnce([deny]);
    await expect(service.list("actor", "task", request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("checks task and approval rights again before submitting an atomic decision", async () => {
    await service.decide("actor", "task", "approval-1", "approved", request());
    expect(taskIam.authorize).toHaveBeenCalledTimes(2);
    expect(iam.authorizeMany).toHaveBeenCalledTimes(2);
    expect(repository.decideApprovalTarget).toHaveBeenCalledWith(task, "owner", targets[0], "approved");
    repository.decideApprovalTarget.mockClear();
    iam.authorizeMany.mockResolvedValueOnce([deny]);
    await expect(service.decide("actor", "task", "approval-1", "approved", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.decideApprovalTarget).not.toHaveBeenCalled();
  });
  it("rejects an approval from another task and stale task state", async () => {
    repository.findApprovalTarget.mockResolvedValueOnce({ ...targets[0], taskId: "other-task" });
    await expect(service.decide("actor", "task", "approval-1", "rejected", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    taskIam.authorize
      .mockResolvedValueOnce({ target: task, principal })
      .mockResolvedValueOnce({ target: { ...task, updateTime: new Date(2) }, principal });
    await expect(service.decide("actor", "task", "approval-1", "rejected", request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.decideApprovalTarget).not.toHaveBeenCalled();
  });
});
