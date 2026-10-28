import type { ResourceResolver } from "./resource-resolvers";
import { accessKeyArn, isCanonicalAccessKeyId } from "../resources/accesskey-resources";
/** Actual ownership is checked again by the service and final transaction. */
export const accessKeyResourceResolver: ResourceResolver = ({ request, principal }) => {
  if (!isCanonicalAccessKeyId(request.params.id) || !isCanonicalAccessKeyId(principal.subjectUserId)) return undefined;
  return accessKeyArn(principal.accountOwnerId, principal.subjectUserId, request.params.id);
};
