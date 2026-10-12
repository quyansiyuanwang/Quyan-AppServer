import {
  RELAY_CONFIGURATION_KEYS,
  RELAY_PROXY_CONFIGURATION_KEYS,
  AUTO_PROXY_POOL_CONFIGURATION_KEYS,
} from "@/constant/config-keysets";
import { CONFIG_KEYS } from "@/constant/config-keys";
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

function registeredConfigurationResources(keys: readonly string[]): BatchResourceResolver {
  if (!keys.length || new Set(keys).size !== keys.length || keys.some((key) => !isRegisteredConfigurationKey(key)))
    throw new Error("Invalid registered configuration resolver");
  const resources = Object.freeze([...keys].sort().map(platformConfigurationArn));
  return () => [...resources];
}
export const registrationConfigurationResources = registeredConfigurationResources(
  Object.values(CONFIG_KEYS.REGISTRATION),
);
export const smtpConfigurationResources = registeredConfigurationResources(Object.values(CONFIG_KEYS.SMTP));
export const siteConfigurationResources = registeredConfigurationResources(Object.values(CONFIG_KEYS.SITE));
export const notificationConfigurationResources = registeredConfigurationResources(
  Object.values(CONFIG_KEYS.NOTIFICATION),
);
export const billingConfigurationResources = registeredConfigurationResources(Object.values(CONFIG_KEYS.BILLING));
export const heartbeatConfigurationResources = registeredConfigurationResources(Object.values(CONFIG_KEYS.HEARTBEAT));
export const remoteTerminalUnbindConfigurationResources = registeredConfigurationResources(
  Object.values(CONFIG_KEYS.REMOTE_TERMINAL),
);
export const relayConfigurationResources = registeredConfigurationResources(RELAY_CONFIGURATION_KEYS);
export const relayProxyConfigurationResources = registeredConfigurationResources(RELAY_PROXY_CONFIGURATION_KEYS);
export const autoProxyPoolConfigurationResources = registeredConfigurationResources(AUTO_PROXY_POOL_CONFIGURATION_KEYS);
