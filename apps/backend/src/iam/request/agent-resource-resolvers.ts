import { AgentRepository } from "@/store/agent/agent.repository";
import { agentMachineArn, isCanonicalAgentId } from "../resources/agent-resources";
import type { ResourceResolver } from "./resource-resolvers";

/** Only trusted account and owner metadata enters a machine ARN; never the registration token. */
export const agentMachineResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.machineId;
  if (!isCanonicalAgentId(id)) return undefined;
  const target = await AgentRepository.getInstance().findMachineTarget(
    id,
    principal.subjectUserId,
    principal.accountOwnerId,
  );
  if (!target || target.id !== id || target.userId !== principal.subjectUserId) return undefined;
  return agentMachineArn(principal.accountOwnerId, target.userId, target.id);
};
