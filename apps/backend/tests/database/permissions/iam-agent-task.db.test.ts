import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { AgentRepository } from "@/store/agent/agent.repository";
import { AgentTaskIamService } from "@/services/agent/agent-task-iam.service";
import { RamPolicyRepository } from "@/store/users/ram-policy.repository";
import { RamResourceGroupRepository } from "@/store/users/ram-resource-group.repository";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { agentTaskArn } from "@/iam/resources/agent-resources";
import { AGENT_TASK_LIMITS } from "@/services/agent/agent-task.policy";
import type { TypedRequest } from "@/types/express";
const repository = AgentRepository.getInstance();
let owner: string, actor: string, other: string, foreign: string;
const user = async (accountOwnerId?: string) =>
  (
    await prisma.user.create({
      data: {
        username: "task-fixture-" + randomUUID(),
        password: "fixture-only",
        accountOwnerId,
        permissionAdds: [],
        permissionRemoves: [],
      },
    })
  ).id;
beforeEach(async () => {
  owner = await user();
  actor = await user(owner);
  other = await user(owner);
  foreign = await user();
});
const task = async (userId = actor) => {
  const workspace = await repository.createWorkspace({ userId, name: "fixture", policy: {}, limits: {} });
  const token = await prisma.relayToken.create({ data: { userId, token: "fixture-only-" + randomUUID() } });
  const conversation = await prisma.conversation.create({ data: { userId, relayTokenId: token.id } });
  return repository.createTask({
    userId,
    workspaceId: workspace.id,
    conversationId: conversation.id,
    relayTokenId: token.id,
    model: "fixture",
    prompt: "private-prompt",
    maxSteps: 1,
    budget: undefined,
  });
};
const request = () =>
  ({
    user: { userId: actor },
    authContext: { principalUserId: actor, accountOwnerId: owner },
    headers: {},
  }) as unknown as TypedRequest;
describe("Agent task events and cancellation storage boundaries", () => {
  it("reads only scoped metadata and bounded, ordered event payload pages", async () => {
    const selected = await task();
    await prisma.agentRunEvent.createMany({
      data: Array.from({ length: AGENT_TASK_LIMITS.eventsPerPage + 1 }, (_, index) => ({
        taskId: selected.id,
        sequence: index + 1,
        eventType: "assistant_delta",
        payload: { content: "private" },
      })),
    });
    const target = (await repository.findTaskTarget(selected.id, actor, owner))!;
    expect(target).not.toHaveProperty("prompt");
    expect(target).not.toHaveProperty("relayTokenId");
    expect(await repository.findTaskTarget(selected.id, other, owner)).toBeNull();
    expect(await repository.findTaskTarget(selected.id, actor, foreign)).toBeNull();
    const first = await repository.listTaskEvents(target, owner, 0);
    expect(first).toHaveLength(AGENT_TASK_LIMITS.eventsPerPage);
    expect(first[0].sequence).toBe(1);
    expect(
      (await repository.listTaskEvents(target, owner, first[first.length - 1].sequence)).map((row) => row.sequence),
    ).toEqual([AGENT_TASK_LIMITS.eventsPerPage + 1]);
    expect(await repository.listTaskEvents(target, foreign, 0)).toEqual([]);
    await prisma.user.update({ where: { id: actor }, data: { status: 0 } });
    expect(await repository.listTaskEvents(target, owner, 0)).toEqual([]);
  });
  it("rejects stale or cross-account cancellations and cancelled tasks cannot restart", async () => {
    const selected = await task(),
      target = (await repository.findTaskTarget(selected.id, actor, owner))!;
    await expect(repository.cancelTaskTarget(target, foreign)).rejects.toMatchObject({ statusCode: 403 });
    await repository.cancelTaskTarget(target, owner);
    await expect(repository.cancelTaskTarget(target, owner)).rejects.toMatchObject({ statusCode: 403 });
    expect(await repository.startQueuedTask(selected.id, "worker", new Date(Date.now() + 1000))).toBe(false);
    expect(await repository.failRunningTask(selected.id, "worker")).toBe(false);
    expect((await prisma.agentTask.findUnique({ where: { id: selected.id } }))?.taskStatus).toBe("cancelled");
    await expect(
      repository.cancelTaskTarget((await repository.findTaskTarget(selected.id, actor, owner))!, owner),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("requires the current worker lease and cancellation wins over late failure updates", async () => {
    const selected = await task();
    expect(await repository.startQueuedTask(selected.id, "worker", new Date(Date.now() + 1000))).toBe(true);
    expect(await repository.startQueuedTask(selected.id, "other-worker", new Date(Date.now() + 1000))).toBe(false);
    expect(await repository.failRunningTask(selected.id, "other-worker")).toBe(false);
    await repository.cancelTaskTarget((await repository.findTaskTarget(selected.id, actor, owner))!, owner);
    expect(await repository.failRunningTask(selected.id, "worker")).toBe(false);
  });
  it("checks resource groups and rejects foreign or removed workspace relationships", async () => {
    const selected = await task(),
      groups = RamResourceGroupRepository.getInstance();
    expect(await groups.resourceExistsInAccount(agentTaskArn(owner, actor, selected.id), owner)).toBe(true);
    expect(await groups.resourceExistsInAccount(agentTaskArn(owner, other, selected.id), owner)).toBe(false);
    const foreignTask = await task(foreign);
    await prisma.agentTask.update({ where: { id: selected.id }, data: { workspaceId: foreignTask.workspaceId } });
    expect(await repository.findTaskTarget(selected.id, actor, owner)).toBeNull();
    expect(await groups.resourceExistsInAccount(agentTaskArn(owner, actor, selected.id), owner)).toBe(false);
  });
  it("atomically decides pending approvals and cannot resume cancelled or expired tasks", async () => {
    const selected = await task();
    await prisma.agentTask.update({ where: { id: selected.id }, data: { taskStatus: "waiting_approval" } });
    const step = await prisma.agentTaskStep.create({ data: { taskId: selected.id, sequence: 1, kind: "tool" } });
    const approval = await prisma.agentApproval.create({
      data: {
        taskId: selected.id,
        stepId: step.id,
        expiresAt: new Date(Date.now() + 60_000),
        toolCall: { command: "private" },
      },
    });
    const target = (await repository.findTaskTarget(selected.id, actor, owner))!;
    const metadata = (await repository.findApprovalTarget(approval.id, target, owner))!;
    expect(metadata).not.toHaveProperty("toolCall");
    expect((await repository.readApprovalTargets(target, owner, [metadata]))[0].toolCall).toEqual({
      command: "private",
    });
    await expect(repository.decideApprovalTarget(target, foreign, metadata, "approved")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.agentApproval.findUnique({ where: { id: approval.id } }))?.status).toBe("pending");
    await prisma.agentApproval.update({
      where: { id: approval.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(repository.decideApprovalTarget(target, owner, metadata, "approved")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect((await prisma.agentTask.findUnique({ where: { id: selected.id } }))?.taskStatus).toBe("waiting_approval");
    await prisma.agentApproval.update({ where: { id: approval.id }, data: { expiresAt: metadata.expiresAt } });
    await repository.cancelTaskTarget(target, owner);
    await expect(repository.decideApprovalTarget(target, owner, metadata, "approved")).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.agentApproval.findUnique({ where: { id: approval.id } }))?.status).toBe("pending");
    await prisma.agentTask.update({ where: { id: selected.id }, data: { taskStatus: "waiting_approval" } });
    const current = (await repository.findTaskTarget(selected.id, actor, owner))!;
    await repository.decideApprovalTarget(current, owner, metadata, "rejected");
    expect((await prisma.agentApproval.findUnique({ where: { id: approval.id } }))?.status).toBe("rejected");
    expect((await prisma.agentTask.findUnique({ where: { id: selected.id } }))?.taskStatus).toBe("failed");
    await expect(repository.decideApprovalTarget(current, owner, metadata, "approved")).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("reads minimal token configuration and checks all task dependencies in the creation transaction", async () => {
    const selected = await task();
    const workspace = (await repository.findWorkspaceTarget(selected.workspaceId, actor, owner))!;
    const conversation = (await repository.findAgentConversationTarget(selected.conversationId, actor, owner))!;
    const token = (await repository.findAgentRelayTokenTarget(selected.relayTokenId, actor, owner))!;
    expect(token).not.toHaveProperty("token");
    expect(token).not.toHaveProperty("allowedModels");
    const settings = await repository.readAgentRelayTokenConfiguration(token, owner);
    expect(settings).not.toHaveProperty("token");
    expect(settings).not.toHaveProperty("upstreamApiKey");
    const targets = { workspace, conversation, token };
    const data = {
      userId: actor,
      workspaceId: workspace.id,
      conversationId: conversation.id,
      relayTokenId: token.id,
      model: "fixture",
      prompt: "private",
      maxSteps: 1,
      budget: undefined,
    };
    await expect(repository.createTask(data, foreign, targets)).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.createTask(data, owner)).rejects.toMatchObject({ statusCode: 403 });
    expect((await repository.createTask(data, owner, targets)).userId).toBe(actor);
    const groups = RamResourceGroupRepository.getInstance();
    expect(
      await groups.resourceExistsInAccount("acs:relay:*:" + owner + ":token/" + actor + "/" + token.id, owner),
    ).toBe(true);
    expect(
      await groups.resourceExistsInAccount("acs:relay:*:" + owner + ":token/" + other + "/" + token.id, owner),
    ).toBe(false);
    await prisma.relayToken.update({
      where: { id: token.id },
      data: { allowedModels: "changed", updateTime: new Date(token.updateTime.getTime() + 1000) },
    });
    expect(await repository.readAgentRelayTokenConfiguration(token, owner)).toBeNull();
    await expect(repository.createTask(data, owner, targets)).rejects.toMatchObject({ statusCode: 403 });
    await prisma.relayToken.update({ where: { id: token.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await repository.findAgentRelayTokenTarget(token.id, actor, owner)).toBeNull();
    expect(
      await groups.resourceExistsInAccount("acs:relay:*:" + owner + ":token/" + actor + "/" + token.id, owner),
    ).toBe(false);
  });
  it("enforces real policy bindings and revocation without exposing payloads", async () => {
    const selected = await task();
    await repository.appendEvent(selected.id, "assistant_delta", { content: "private" });
    const parsed = parseIamPolicy({
      Version: "1",
      Statement: [
        {
          Effect: "Allow",
          Action: ["quyan:agent:GetTaskEvents", "quyan:agent:CancelTask"],
          Resource: agentTaskArn(owner, actor, selected.id),
        },
      ],
    });
    const policy = await RamPolicyRepository.getInstance().createPolicy({
      accountOwnerId: owner,
      name: "task-policy-" + randomUUID(),
      permissions: [],
      iamVersion: { ...parsed, createdBy: owner },
    });
    const binding = await prisma.ramAuthorization.create({
      data: {
        accountOwnerId: owner,
        principalType: "user",
        principalId: actor,
        policyId: policy.id,
        scopeType: "account",
        scopeKey: "account",
        createdBy: owner,
      },
    });
    expect((await AgentTaskIamService.getInstance().listEvents(actor, selected.id, 0, request()))[0].payload).toEqual({
      content: "private",
    });
    await prisma.ramAuthorization.update({ where: { id: binding.id }, data: { status: -1 } });
    await expect(AgentTaskIamService.getInstance().listEvents(actor, selected.id, 0, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(AgentTaskIamService.getInstance().cancel(actor, selected.id, request())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect((await prisma.agentTask.findUnique({ where: { id: selected.id } }))?.taskStatus).toBe("queued");
  });
});
