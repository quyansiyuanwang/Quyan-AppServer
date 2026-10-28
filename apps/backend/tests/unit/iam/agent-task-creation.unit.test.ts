import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { AgentTaskCreationTargets } from "@/store/agent/agent.repository";
import type { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { IamEvaluationResult } from "@quyan/shared";
import { getIamActionDefinition } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { Project } from "ts-morph";
import { fileURLToPath } from "node:url";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
vi.mock("@/store/agent/agent.repository", () => ({ AgentRepository: { getInstance: vi.fn() } }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { security: { iamAuthorizationMode: "enforce" } } }));
import { AgentRepository } from "@/store/agent/agent.repository";
import { AgentTaskCreationIamService } from "@/services/agent/agent-task-creation-iam.service";
import { agentTaskCreationResourcesResolver } from "@/iam/request/agent-resource-resolvers";
const repository = mockDeep<AgentRepository>(),
  iam = mockDeep<IamAuthorizationService>();
const Service = AgentTaskCreationIamService as unknown as new (
  repository: AgentRepository,
  iam: IamAuthorizationService,
) => AgentTaskCreationIamService;
const service = new Service(repository, iam);
const targets: AgentTaskCreationTargets = {
  workspace: { id: "workspace", userId: "actor", machineId: null, createTime: new Date(1), updateTime: new Date(1) },
  conversation: { id: "conversation", userId: "actor", relayTokenId: "token", updateTime: new Date(1) },
  token: { id: "token", userId: "actor", expiresAt: null, updateTime: new Date(1) },
};
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    params: { conversationId: "conversation" },
    body: { workspaceId: "workspace", accountId: "foreign" },
    headers: {},
  }) as unknown as TypedRequest;
const allow: IamEvaluationResult = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny: IamEvaluationResult = { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements: [] };
beforeEach(() => {
  vi.resetAllMocks();
  repository.findWorkspaceTarget.mockResolvedValue(targets.workspace);
  repository.findAgentConversationTarget.mockResolvedValue(targets.conversation);
  repository.findAgentRelayTokenTarget.mockResolvedValue(targets.token);
  iam.authorizeMany.mockImplementation(async ({ resources }) => resources.map(() => allow));
  repository.readAgentWorkspaceConfiguration.mockResolvedValue({
    id: "workspace",
    userId: "actor",
    limits: { budget: 1 },
  });
  repository.readAgentRelayTokenConfiguration.mockResolvedValue({
    id: "token",
    userId: "actor",
    allowedModels: "fixture-model",
    modelMapping: {},
  });
  vi.mocked(AgentRepository.getInstance).mockReturnValue(repository);
});
describe("Agent task creation dependency authorization", () => {
  it("registers real actions and derives workspace/conversation resources from trusted ownership", async () => {
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await agentTaskCreationResourcesResolver({ request: request(), principal })).toEqual([
      "acs:agent:*:owner:workspace/actor/workspace",
      "acs:chat:*:owner:conversation/conversation",
    ]);
    expect(getIamActionDefinition("quyan:agent:UseRelayToken")?.resourceTypes).toEqual(["relay/token"]);
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const route = collectIamRoutes(
      new Project({ skipAddingFilesFromTsConfig: true }).addSourceFilesAtPaths(
        root + "src/api/controllers/v1/chat/agent-run.controller.ts",
      ),
      root,
    )[0];
    expect(route.coverage).toBe("explicit");
    expect(route.issues).toEqual([]);
  });
  it("requires creation on both resources and token use before reading model settings", async () => {
    const authorization = await service.authorize("actor", "conversation", "workspace", undefined, request());
    expect(authorization.targets).toEqual(targets);
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:agent:CreateTask",
        resources: ["acs:agent:*:owner:workspace/actor/workspace", "acs:chat:*:owner:conversation/conversation"],
      }),
    );
    expect(iam.authorizeMany).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:agent:UseRelayToken",
        resources: ["acs:relay:*:owner:token/actor/token"],
      }),
    );
    expect(repository.readAgentRelayTokenConfiguration).not.toHaveBeenCalled();
    expect(await service.configuration(authorization)).toMatchObject({ token: { allowedModels: "fixture-model" } });
  });
  it("rejects a partial creation allow and token Deny before sensitive configuration reads", async () => {
    iam.authorizeMany.mockResolvedValueOnce([allow, deny]);
    await expect(service.authorize("actor", "conversation", "workspace", undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.findAgentRelayTokenTarget).not.toHaveBeenCalled();
    iam.authorizeMany.mockResolvedValueOnce([allow, allow]).mockResolvedValueOnce([deny]);
    await expect(service.authorize("actor", "conversation", "workspace", undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.readAgentRelayTokenConfiguration).not.toHaveBeenCalled();
  });
  it("rejects foreign dependencies, invalid IDs and missing trusted identity", async () => {
    await expect(service.authorize("actor", "conversation", "workspace")).rejects.toMatchObject({ statusCode: 403 });
    repository.findWorkspaceTarget.mockResolvedValueOnce({ ...targets.workspace, userId: "foreign" });
    await expect(service.authorize("actor", "conversation", "workspace", undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    repository.findAgentRelayTokenTarget.mockResolvedValueOnce({ ...targets.token, userId: "other" });
    await expect(service.authorize("actor", "conversation", "workspace", undefined, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      service.authorize("actor", "conversation", "../workspace", undefined, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("resolves explicit token selection independently of the conversation default", async () => {
    repository.findAgentRelayTokenTarget.mockResolvedValueOnce({ ...targets.token, id: "override" });
    expect(
      (await service.authorize("actor", "conversation", "workspace", "override", request())).targets.token.id,
    ).toBe("override");
    expect(repository.findAgentRelayTokenTarget).toHaveBeenCalledWith("override", "actor", "owner");
  });
  it("rejects changed configuration snapshots and credential-bearing repository responses", async () => {
    const authorization = await service.authorize("actor", "conversation", "workspace", undefined, request());
    repository.readAgentRelayTokenConfiguration.mockResolvedValueOnce(null);
    await expect(service.configuration(authorization)).rejects.toMatchObject({ statusCode: 403 });
    repository.readAgentRelayTokenConfiguration.mockResolvedValueOnce({
      id: "token",
      userId: "actor",
      allowedModels: null,
      modelMapping: null,
      upstreamApiKey: "fixture-private",
    } as Awaited<ReturnType<AgentRepository["readAgentRelayTokenConfiguration"]>>);
    await expect(service.configuration(authorization)).rejects.toMatchObject({ statusCode: 403 });
  });
});
