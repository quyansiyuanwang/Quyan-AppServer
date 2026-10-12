import type { BatchResourceResolver } from "./resource-resolvers";
import { isRegisteredConfigurationKey, platformConfigurationArn } from "../resources/platform-configuration-resources";
import { IAM_AUTHORIZATION_LIMITS } from "../authorization-limits";
export const platformConfigurationBatchResolver: BatchResourceResolver = ({ request }) => {
  const body = request.body as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const configs = (body as Record<string, unknown>).configs;
  if (!configs || typeof configs !== "object" || Array.isArray(configs)) return undefined;
  const keys = Object.keys(configs);
  if (
    !keys.length ||
    keys.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
    keys.some(
      (key) => !isRegisteredConfigurationKey(key) || typeof (configs as Record<string, unknown>)[key] !== "string",
    )
  )
    return undefined;
  return keys.sort().map(platformConfigurationArn);
};
