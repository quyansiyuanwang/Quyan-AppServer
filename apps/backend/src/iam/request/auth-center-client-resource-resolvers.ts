import type { ResourceResolver } from "./resource-resolvers";
import { authCenterClientArn, isCanonicalOAuthClientId } from "../resources/auth-center-client-resources";
/** Route metadata fixes the action; authentication fixes both account and client owner. */
export const authCenterClientResourceResolver: ResourceResolver = ({ request, principal }) => {
  const id = request.params.id;
  if (!isCanonicalOAuthClientId(id) || principal.subjectUserId !== principal.principalUserId) return undefined;
  return authCenterClientArn(principal.accountOwnerId, principal.subjectUserId, id);
};
