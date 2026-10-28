import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { IamEvaluationResult } from "@quyan/shared";
import { Permission, getIamActionDefinition, iamActionsForLegacyPermission } from "@quyan/shared";
import { Project } from "ts-morph";
import { fileURLToPath } from "node:url";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { AgentTaskTarget } from "@/store/agent/agent.repository";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { TypedRequest } from "@/types/express";
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
import { AgentTaskIamService } from "@/services/agent/agent-task-iam.service";
import { AgentRepository } from "@/store/agent/agent.repository";
import { agentTaskResourceResolver } from "@/iam/request/agent-resource-resolvers";
const repository = mockDeep<AgentRepository>(),
  iam = mockDeep<IamAuthorizationService>();
const Service = AgentTaskIamService as unknown as new (
  repository: AgentRepository,
  iam: IamAuthorizationService,
) => AgentTaskIamService;
const service = new Service(repository, iam);
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { taskId: "task-1" },
    headers: {},
    query: { action: "forged", accountId: "foreign" },
  }) as unknown as TypedRequest;
const target: AgentTaskTarget = {
  id: "task-1",
  userId: "actor",
  workspaceId: "workspace",
  taskStatus: "running",
  updateTime: new Date(1),
};
const event = (sequence = 1) => ({
  taskId: "task-1",
  sequence,
  eventType: "assistant_delta",
  payload: { content: "private" },
  createTime: new Date(1),
});
const allow: IamEvaluationResult = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny: IamEvaluationResult = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
beforeEach(() => {
  vi.resetAllMocks();
  repository.findTaskTarget.mockResolvedValue(target);
  repository.listTaskEvents.mockResolvedValue([event()]);
  iam.authorizeMany.mockResolvedValue([allow]);
  vi.mocked(AgentRepository.getInstance).mockReturnValue(repository);
});
describe("Agent task event and cancellation resource authorization", () => {
  it("registers task actions and exact server resource resolvers", async () => {
    expect(getIamActionDefinition("quyan:agent:GetTaskEvents")?.resourceTypes).toEqual(["agent/task"]);
    expect(iamActionsForLegacyPermission(Permission.AGENT_TASK_RUN)).toContain("quyan:agent:CancelTask");
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await agentTaskResourceResolver({ request: request(), principal })).toBe(
      "acs:agent:*:owner:task/actor/task-1",
    );
    repository.findTaskTarget.mockResolvedValueOnce({ ...target, userId: "foreign" });
    expect(await agentTaskResourceResolver({ request: request(), principal })).toBeUndefined();
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const routes = collectIamRoutes(
      new Project({ skipAddingFilesFromTsConfig: true }).addSourceFilesAtPaths(
        root + "src/api/controllers/v1/agent/agent.controller.ts",
      ),
      root,
    ).filter((route) => /\/(cancel|events)$/.test(route.key));
    expect(routes).toHaveLength(2);
    expect(routes.every((route) => route.coverage === "explicit" && !route.issues.length)).toBe(true);
  });
  it("authorizes events before hydration and rechecks current permission before returning", async () => {
    expect(await service.listEvents("actor", "task-1", 0, request())).toEqual([event()]);
    expect(repository.listTaskEvents).toHaveBeenCalledWith(target, "owner", 0);
    expect(iam.authorizeMany.mock.invocationCallOrder[0]).toBeLessThan(
      repository.listTaskEvents.mock.invocationCallOrder[0],
    );
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValueOnce([deny]);
    await expect(service.listEvents("actor", "task-1", 0, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not hydrate event payloads after a deny, missing identity or invalid metadata", async () => {
    iam.authorizeMany.mockResolvedValueOnce([deny]);
    await expect(service.listEvents("actor", "task-1", 0, request())).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.listEvents("actor", "task-1", 0)).rejects.toMatchObject({ statusCode: 403 });
    repository.findTaskTarget.mockResolvedValueOnce({ ...target, userId: "other" });
    await expect(service.listEvents("actor", "task-1", 0, request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.listTaskEvents).not.toHaveBeenCalled();
  });
  it.each([-1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid event cursor %s", async (cursor) => {
    await expect(service.listEvents("actor", "task-1", cursor, request())).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.listTaskEvents).not.toHaveBeenCalled();
  });
  it("rejects event source substitution and non-monotonic pages", async () => {
    for (const rows of [[{ ...event(), taskId: "foreign" }], [event(1), event(1)], [event(0)]]) {
      repository.listTaskEvents.mockResolvedValueOnce(rows);
      await expect(service.listEvents("actor", "task-1", 0, request())).rejects.toMatchObject({ statusCode: 403 });
    }
    repository.findTaskTarget
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce({ ...target, workspaceId: "other-workspace" });
    await expect(service.listEvents("actor", "task-1", 0, request())).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rechecks cancellation before a scoped write and rejects changed task snapshots", async () => {
    await service.cancel("actor", "task-1", request());
    expect(repository.cancelTaskTarget).toHaveBeenCalledWith(target, "owner");
    repository.cancelTaskTarget.mockClear();
    iam.authorizeMany.mockResolvedValueOnce([allow]).mockResolvedValueOnce([deny]);
    await expect(service.cancel("actor", "task-1", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.cancelTaskTarget).not.toHaveBeenCalled();
    repository.findTaskTarget
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce({ ...target, updateTime: new Date(2) });
    await expect(service.cancel("actor", "task-1", request())).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.cancelTaskTarget).not.toHaveBeenCalled();
  });
});
