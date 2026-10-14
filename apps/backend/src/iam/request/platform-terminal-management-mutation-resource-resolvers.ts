import type { IamTerminalManagementMutation } from "@quyan/shared";
import { IAM_REMOTE_TERMINAL_MANAGEMENT_MUTATIONS } from "@quyan/shared";
import type { ResourceResolver } from "./resource-resolvers";
import { isPlatformLogResourceId } from "../resources/platform-log-resources";
import {
  platformTerminalBindingArn,
  platformTerminalEntitlementArn,
} from "../resources/platform-terminal-entitlement-resources";
import { PlatformTerminalManagementMutationRepository } from "@/store/remote-terminal-product/platform-terminal-management-mutation.repository";
function resolver(operation: IamTerminalManagementMutation): ResourceResolver {
  return async ({ request, principal }) => {
    const id = request.params.id;
    if (!isPlatformLogResourceId(id)) return undefined;
    const owner = await PlatformTerminalManagementMutationRepository.getInstance().owner(principal, operation, id);
    if (!owner) return undefined;
    const entry = IAM_REMOTE_TERMINAL_MANAGEMENT_MUTATIONS.find((value) => value.operation === operation);
    return entry?.kind === "binding"
      ? platformTerminalBindingArn(owner, id)
      : platformTerminalEntitlementArn(owner, id);
  };
}
export const platformTerminalRevokeBindingResource = resolver("RevokeDeviceBinding");
export const platformTerminalDeleteEntitlementResource = resolver("DeleteEntitlement");
export const platformTerminalResetUnbindResource = resolver("ResetUnbindCount");
