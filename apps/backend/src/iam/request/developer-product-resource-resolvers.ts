import { DeveloperProductInstanceRepository } from "@/store/developer/developer-product-instance.repository";
import type { DeveloperProductCode } from "@quyan/shared";
import type { ResourceResolver } from "./resource-resolvers";
import {
  developerKvKeySchema,
  developerProjectIdSchema,
  developerSecretAliasSchema,
} from "@/api/schema/developer/developer.schema";
import {
  developerItemArn,
  developerProjectArn,
  isCanonicalDeveloperIdentifier,
  type DeveloperItemResourceType,
} from "../resources/developer-resources";
import { ramAccountResourceResolver } from "./resource-resolvers";

const instances = DeveloperProductInstanceRepository.getInstance();

const productCodes: readonly DeveloperProductCode[] = ["json_endpoint", "kv", "short_link", "secret", "status", "push"];

function instanceId(request: Parameters<ResourceResolver>[0]["request"]): string | undefined {
  const value = request.params.instanceId;
  return typeof value === "string" && isCanonicalDeveloperIdentifier(developerProjectIdSchema, value)
    ? value
    : undefined;
}

async function backingProject(
  request: Parameters<ResourceResolver>[0]["request"],
  accountOwnerId: string,
  productCode: DeveloperProductCode,
): Promise<string | undefined> {
  if (!productCodes.includes(productCode)) return undefined;
  const id = instanceId(request);
  if (!id) return undefined;
  return instances.findActiveBackingProjectId(id, productCode, accountOwnerId);
}

function projectResolver(productCode: DeveloperProductCode): ResourceResolver {
  return async ({ request, principal }) => {
    const projectId = await backingProject(request, principal.accountOwnerId, productCode);
    return projectId ? developerProjectArn(principal.accountOwnerId, projectId) : undefined;
  };
}

function itemResolver(
  productCode: DeveloperProductCode,
  type: DeveloperItemResourceType,
  readId: (request: Parameters<ResourceResolver>[0]["request"]) => unknown,
  validateId: (value: unknown) => value is string,
): ResourceResolver {
  return async ({ request, principal }) => {
    const projectId = await backingProject(request, principal.accountOwnerId, productCode);
    const id = readId(request);
    if (!projectId || !validateId(id)) return undefined;
    return developerItemArn(type, principal.accountOwnerId, projectId, id);
  };
}

const validProjectId = (value: unknown): value is string =>
  isCanonicalDeveloperIdentifier(developerProjectIdSchema, value);
const validKvKey = (value: unknown): value is string => isCanonicalDeveloperIdentifier(developerKvKeySchema, value);
const validSecretAlias = (value: unknown): value is string =>
  isCanonicalDeveloperIdentifier(developerSecretAliasSchema, value);

export const developerProductJsonProjectResourceResolver = projectResolver("json_endpoint");
export const developerProductKvProjectResourceResolver = projectResolver("kv");
export const developerProductShortLinkProjectResourceResolver = projectResolver("short_link");
export const developerProductSecretProjectResourceResolver = projectResolver("secret");
export const developerProductStatusProjectResourceResolver = projectResolver("status");
export const developerProductPushProjectResourceResolver = projectResolver("push");

export const developerProductKvItemResourceResolver = itemResolver(
  "kv",
  "kv-item",
  (request) => request.params.key,
  validKvKey,
);
export const developerProductShortLinkResourceResolver = itemResolver(
  "short_link",
  "short-link",
  (request) => request.params.id,
  validProjectId,
);
export const developerProductSecretResourceResolver = itemResolver(
  "secret",
  "secret",
  (request) => request.params.alias ?? (request.body as { alias?: unknown })?.alias,
  validSecretAlias,
);
export const developerProductStatusMonitorResourceResolver = itemResolver(
  "status",
  "status-monitor",
  (request) => request.params.id,
  validProjectId,
);
export const developerProductPushChannelResourceResolver = itemResolver(
  "push",
  "push-channel",
  (request) => request.params.id,
  validProjectId,
);
export const developerProductPushDeliveryProjectResourceResolver = developerProductPushProjectResourceResolver;

export const developerProductSecretInstanceResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const secretInstanceId = request.params.secretInstanceId;
  const alias = (request.params.alias ?? (request.body as { alias?: unknown })?.alias) as unknown;
  if (!validProjectId(secretInstanceId) || !validSecretAlias(alias)) return undefined;
  const projectId = await instances.findActiveBackingProjectId(secretInstanceId, "secret", principal.accountOwnerId);
  return projectId ? developerItemArn("secret", principal.accountOwnerId, projectId, alias) : undefined;
};

export const developerProductSecretInstanceProjectResourceResolver: ResourceResolver = async ({
  request,
  principal,
}) => {
  const secretInstanceId = request.params.secretInstanceId;
  if (!validProjectId(secretInstanceId)) return undefined;
  const projectId = await instances.findActiveBackingProjectId(secretInstanceId, "secret", principal.accountOwnerId);
  return projectId ? developerProjectArn(principal.accountOwnerId, projectId) : undefined;
};

export const developerProductInstanceListResourceResolver: ResourceResolver = (context) =>
  ramAccountResourceResolver(context);
