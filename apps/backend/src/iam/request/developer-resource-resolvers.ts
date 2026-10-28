import type { ResourceResolver } from "./resource-resolvers";
import {
  developerProjectIdSchema,
  developerKvKeySchema,
  developerSecretAliasSchema,
} from "@/api/schema/developer/developer.schema";
import {
  developerProjectArn,
  developerKvArn,
  developerSecretArn,
  developerShortLinkArn,
  developerProjectApiKeyArn,
  developerStatusMonitorArn,
  developerPushChannelArn,
  developerPushDeliveryArn,
  isCanonicalDeveloperIdentifier,
} from "../resources/developer-resources";
export { developerProjectArn, developerKvArn, developerSecretArn } from "../resources/developer-resources";
export const developerProjectResourceResolver: ResourceResolver = ({ request, principal }) => {
  const id = request.params.projectId;
  if (typeof id !== "string" || !isCanonicalDeveloperIdentifier(developerProjectIdSchema, id)) return undefined;
  return developerProjectArn(principal.accountOwnerId, id);
};
export const developerKvResourceResolver: ResourceResolver = ({ request, principal }) => {
  const { projectId, key } = request.params;
  if (
    typeof projectId !== "string" ||
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, projectId) ||
    typeof key !== "string" ||
    !isCanonicalDeveloperIdentifier(developerKvKeySchema, key)
  )
    return undefined;
  return developerKvArn(principal.accountOwnerId, projectId, key);
};
export const developerSecretResourceResolver: ResourceResolver = ({ request, principal }) => {
  const projectId = request.params.projectId;
  const alias = request.params.alias ?? (request.body as { alias?: unknown })?.alias;
  if (
    typeof projectId !== "string" ||
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, projectId) ||
    typeof alias !== "string" ||
    !isCanonicalDeveloperIdentifier(developerSecretAliasSchema, alias)
  )
    return undefined;
  return developerSecretArn(principal.accountOwnerId, projectId, alias);
};

export const developerShortLinkResourceResolver: ResourceResolver = ({ request, principal }) => {
  const { projectId, id } = request.params;
  if (
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, projectId) ||
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, id)
  )
    return undefined;
  return developerShortLinkArn(principal.accountOwnerId, projectId, id);
};

export const developerProjectApiKeyResourceResolver: ResourceResolver = ({ request, principal }) => {
  const { projectId, id } = request.params;
  if (
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, projectId) ||
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, id)
  )
    return undefined;
  return developerProjectApiKeyArn(principal.accountOwnerId, projectId, id);
};

export const developerStatusMonitorResourceResolver: ResourceResolver = ({ request, principal }) => {
  const { projectId, id } = request.params;
  if (
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, projectId) ||
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, id)
  )
    return undefined;
  return developerStatusMonitorArn(principal.accountOwnerId, projectId, id);
};

export const developerPushChannelResourceResolver: ResourceResolver = ({ request, principal }) => {
  const { projectId, id } = request.params;
  if (
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, projectId) ||
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, id)
  )
    return undefined;
  return developerPushChannelArn(principal.accountOwnerId, projectId, id);
};

export const developerPushDeliveryResourceResolver: ResourceResolver = ({ request, principal }) => {
  const { projectId, id } = request.params;
  if (
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, projectId) ||
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, id)
  )
    return undefined;
  return developerPushDeliveryArn(principal.accountOwnerId, projectId, id);
};
