import type { ResourceResolver } from "./resource-resolvers";
import { ojApiKeyArn, isCanonicalOjApiKeyId } from "../resources/oj-apikey-resources";
export const ojApiKeyResourceResolver: ResourceResolver = ({ request, principal }) => {
  if (!isCanonicalOjApiKeyId(request.params.id) || !isCanonicalOjApiKeyId(principal.subjectUserId)) return undefined;
  // Service and transactional repository enforce the real record's owner; endpoint input cannot change account.
  return ojApiKeyArn(principal.accountOwnerId, principal.subjectUserId, request.params.id);
};
