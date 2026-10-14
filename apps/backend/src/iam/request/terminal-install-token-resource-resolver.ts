import type { ResourceResolver } from "./resource-resolvers";
import { isRemoteTerminalId, remoteTerminalProductEntitlementArn } from "../resources/remote-terminal-resources";
export const terminalInstallTokenResource: ResourceResolver = ({ request, principal }) => {
  const id = request.params.id;
  return isRemoteTerminalId(id)
    ? remoteTerminalProductEntitlementArn(principal.accountOwnerId, principal.subjectUserId, id)
    : undefined;
};
