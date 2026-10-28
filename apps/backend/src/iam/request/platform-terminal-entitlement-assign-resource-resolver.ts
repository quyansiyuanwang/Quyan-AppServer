import type { ResourceResolver } from "./resource-resolvers";
import { platformUserArn, isPlatformUserId } from "../resources/platform-user-resources";
export const platformTerminalEntitlementAssignResource: ResourceResolver = ({ request }) => {
  const id = (request.body as { userId?: unknown } | undefined)?.userId;
  return isPlatformUserId(id) ? platformUserArn(id) : undefined;
};
