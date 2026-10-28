import type { ResourceResolver } from "./resource-resolvers";
import { platformAuthCenterReviewClientArn } from "../resources/platform-auth-center-resources";
import { isCanonicalOAuthClientId } from "../resources/oauth-client-resources";

export const platformAuthCenterReviewClientResourceResolver: ResourceResolver = ({ request }) =>
  isCanonicalOAuthClientId(request.params.id) ? platformAuthCenterReviewClientArn(request.params.id) : undefined;
