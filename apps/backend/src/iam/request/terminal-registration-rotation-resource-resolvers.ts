import type { ResourceResolver } from "./resource-resolvers";
import { isRemoteTerminalId, remoteTerminalProductEntitlementArn } from "../resources/remote-terminal-resources";
import { platformTerminalEntitlementArn } from "../resources/platform-terminal-entitlement-resources";
import { TerminalRegistrationRotationRepository } from "@/store/remote-terminal-product/terminal-registration-rotation.repository";
export const terminalPersonalRegistrationRotationResource: ResourceResolver = ({ request, principal }) => {
  const id = request.params.id;
  return isRemoteTerminalId(id)
    ? remoteTerminalProductEntitlementArn(principal.accountOwnerId, principal.subjectUserId, id)
    : undefined;
};
export const terminalManagementRegistrationRotationResource: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.id;
  if (!isRemoteTerminalId(id)) return undefined;
  const owner = await TerminalRegistrationRotationRepository.getInstance().owner(
    principal,
    "RotateRegistrationToken",
    id,
  );
  return owner ? platformTerminalEntitlementArn(owner, id) : undefined;
};
