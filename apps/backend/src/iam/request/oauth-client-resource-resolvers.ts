import type { ResourceResolver } from "./resource-resolvers";
import { isCanonicalOAuthClientId, oauthClientArn } from "../resources/oauth-client-resources";
export const oauthClientResourceResolver: ResourceResolver = ({ request, principal }) => {
  if (!isCanonicalOAuthClientId(request.params.id) || !isCanonicalOAuthClientId(principal.subjectUserId))
    return undefined;
  // The service also verifies the persisted owner and excludes platform applications.
  return oauthClientArn(principal.accountOwnerId, principal.subjectUserId, request.params.id);
};
