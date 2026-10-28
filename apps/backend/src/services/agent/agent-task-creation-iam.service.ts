import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { AgentRepository } from "@/store/agent/agent.repository";
import { agentWorkspaceArn, agentRelayTokenArn, isCanonicalAgentId } from "@/iam/resources/agent-resources";
import { chatConversationArn } from "@/iam/resources/chat-resources";
import type { TypedRequest } from "@/types/express";
import { agentIamDenied as denied, trustedAgentIdentity, filterAgentResources } from "./agent-iam-authorization";
export class AgentTaskCreationIamService {
  private static instance: AgentTaskCreationIamService;
  private constructor(
    private readonly repository: Pick<
      AgentRepository,
      | "findWorkspaceTarget"
      | "findAgentConversationTarget"
      | "findAgentRelayTokenTarget"
      | "readAgentWorkspaceConfiguration"
      | "readAgentRelayTokenConfiguration"
    > = AgentRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new AgentTaskCreationIamService());
  }
  async authorize(
    userId: string,
    conversationId: string,
    workspaceId: string,
    relayTokenId?: string,
    request?: TypedRequest,
  ) {
    const identity = trustedAgentIdentity(userId, request);
    if (
      !isCanonicalAgentId(conversationId) ||
      !isCanonicalAgentId(workspaceId) ||
      (relayTokenId !== undefined && !isCanonicalAgentId(relayTokenId))
    )
      throw denied();
    const workspace = await this.repository.findWorkspaceTarget(workspaceId, userId, identity.principal.accountOwnerId);
    const conversation = await this.repository.findAgentConversationTarget(
      conversationId,
      userId,
      identity.principal.accountOwnerId,
    );
    if (
      !workspace ||
      workspace.id !== workspaceId ||
      workspace.userId !== userId ||
      !conversation ||
      conversation.id !== conversationId ||
      conversation.userId !== userId
    )
      throw denied();
    const resources = [
      agentWorkspaceArn(identity.principal.accountOwnerId, userId, workspaceId),
      chatConversationArn(identity.principal.accountOwnerId, conversationId),
    ];
    if (
      (await filterAgentResources(this.iam, identity.request, identity.principal, "quyan:agent:CreateTask", resources))
        .length !== resources.length
    )
      throw denied();
    const tokenId = relayTokenId ?? conversation.relayTokenId;
    if (!isCanonicalAgentId(tokenId)) throw denied();
    const token = await this.repository.findAgentRelayTokenTarget(tokenId, userId, identity.principal.accountOwnerId);
    if (!token || token.id !== tokenId || token.userId !== userId) throw denied();
    if (
      (
        await filterAgentResources(this.iam, identity.request, identity.principal, "quyan:agent:UseRelayToken", [
          agentRelayTokenArn(identity.principal.accountOwnerId, userId, tokenId),
        ])
      ).length !== 1
    )
      throw denied();
    return { principal: identity.principal, targets: { workspace, conversation, token } };
  }
  async configuration(authorization: Awaited<ReturnType<AgentTaskCreationIamService["authorize"]>>) {
    const workspace = await this.repository.readAgentWorkspaceConfiguration(
      authorization.targets.workspace,
      authorization.principal.accountOwnerId,
    );
    const token = await this.repository.readAgentRelayTokenConfiguration(
      authorization.targets.token,
      authorization.principal.accountOwnerId,
    );
    if (
      !workspace ||
      workspace.id !== authorization.targets.workspace.id ||
      workspace.userId !== authorization.targets.workspace.userId ||
      !token ||
      token.id !== authorization.targets.token.id ||
      token.userId !== authorization.targets.token.userId ||
      "runtimeHandle" in workspace ||
      "token" in token ||
      "upstreamApiKey" in token
    )
      throw denied();
    return { workspace, token };
  }
}
