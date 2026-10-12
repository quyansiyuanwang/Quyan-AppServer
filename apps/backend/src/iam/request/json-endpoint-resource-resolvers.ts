import { buildAcsResource } from "@quyan/shared";
import type { ResourceResolver } from "./resource-resolvers";
import { JsonEndpointManagementRepository } from "@/store/system/json-endpoint-management.repository";
import { jsonEndpointArn, isCanonicalJsonEndpointId } from "../resources/json-endpoint-resources";
export const jsonEndpointResourceResolver: ResourceResolver = async ({ request, principal }) => {
  if (!isCanonicalJsonEndpointId(request.params.id)) return undefined;
  const target = await JsonEndpointManagementRepository.getInstance().target(principal, request.params.id);
  if (!target || target.id !== request.params.id || !isCanonicalJsonEndpointId(target.userId)) return undefined;
  return jsonEndpointArn(principal.accountOwnerId, target.userId, target.id);
};

export const jsonEndpointCreationResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const ownerUserId = (request.body as { ownerUserId?: unknown })?.ownerUserId ?? principal.subjectUserId;
  if (!isCanonicalJsonEndpointId(ownerUserId)) return undefined;
  const owner = await JsonEndpointManagementRepository.getInstance().creationOwner(principal, ownerUserId);
  if (!owner || owner.id !== ownerUserId) return undefined;
  return buildAcsResource({
    service: "quyan",
    region: "*",
    accountId: principal.accountOwnerId,
    path: "user/" + owner.id,
  });
};
