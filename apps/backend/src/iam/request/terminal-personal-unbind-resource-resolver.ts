import type { ResourceResolver } from "./resource-resolvers";
import { remoteTerminalProductBindingArn, isRemoteTerminalId } from "../resources/remote-terminal-resources";
/** Trusted authenticated identity; the service independently confirms persisted binding and parent ownership. */
export const terminalPersonalUnbindResource: ResourceResolver = ({ request, principal }) => {
  const id = request.params.id;
  return isRemoteTerminalId(id)
    ? remoteTerminalProductBindingArn(principal.accountOwnerId, principal.subjectUserId, id)
    : undefined;
};
