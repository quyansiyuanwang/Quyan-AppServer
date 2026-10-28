import type { ResourceResolver } from "./resource-resolvers";
import { isRemoteTerminalId, remoteTerminalPublishedTemplateArn } from "../resources/remote-terminal-resources";
/** A published offer is a per-identity projection of the global template, not template-management authority. */
export const terminalPurchaseResource: ResourceResolver = ({ request, principal }) => {
  const id = (request.body as { templateId?: unknown } | undefined)?.templateId;
  return isRemoteTerminalId(id)
    ? remoteTerminalPublishedTemplateArn(principal.accountOwnerId, principal.subjectUserId, id)
    : undefined;
};
