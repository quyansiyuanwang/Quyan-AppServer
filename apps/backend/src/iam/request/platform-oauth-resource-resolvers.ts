import type { ResourceResolver } from "./resource-resolvers";
import { platformOAuthClientArn, platformOAuthControlArn } from "../resources/platform-oauth-resources";
import { isCanonicalOAuthClientId } from "../resources/oauth-client-resources";
export const platformOAuthClientResourceResolver: ResourceResolver = ({ request }) =>
  isCanonicalOAuthClientId(request.params.id) ? platformOAuthClientArn(request.params.id) : undefined;

export const platformOAuthControlResourceResolver: ResourceResolver = () => platformOAuthControlArn();
