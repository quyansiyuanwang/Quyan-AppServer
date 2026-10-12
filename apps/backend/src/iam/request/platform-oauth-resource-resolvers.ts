import type { ResourceResolver } from "./resource-resolvers";
import {
  platformOAuthClientArn,
  platformOAuthControlArn,
  platformOAuthReviewClientArn,
} from "../resources/platform-oauth-resources";
import { isCanonicalOAuthClientId } from "../resources/oauth-client-resources";
export const platformOAuthClientResourceResolver: ResourceResolver = ({ request }) =>
  isCanonicalOAuthClientId(request.params.id) ? platformOAuthClientArn(request.params.id) : undefined;

export const platformOAuthControlResourceResolver: ResourceResolver = () => platformOAuthControlArn();

export const platformOAuthReviewClientResourceResolver: ResourceResolver = ({ request }) =>
  isCanonicalOAuthClientId(request.params.id) ? platformOAuthReviewClientArn(request.params.id) : undefined;
