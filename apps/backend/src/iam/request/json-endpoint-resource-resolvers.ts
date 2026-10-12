import type { ResourceResolver } from "./resource-resolvers";
import { JsonEndpointManagementRepository } from "@/store/system/json-endpoint-management.repository";
import { jsonEndpointArn, isCanonicalJsonEndpointId } from "../resources/json-endpoint-resources";
export const jsonEndpointResourceResolver: ResourceResolver = async ({ request, principal }) => {
  if (!isCanonicalJsonEndpointId(request.params.id)) return undefined;
  const target = await JsonEndpointManagementRepository.getInstance().target(principal, request.params.id);
  if (!target || target.id !== request.params.id || !isCanonicalJsonEndpointId(target.userId)) return undefined;
  return jsonEndpointArn(principal.accountOwnerId, target.userId, target.id);
};
