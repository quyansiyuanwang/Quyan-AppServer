import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { CONFIG_KEYS, configurationKeys } from "@/constant/config-keys";
const registered = new Set(configurationKeys(CONFIG_KEYS));
export const PLATFORM_CONFIGURATION_KEYS: readonly string[] = Object.freeze([...registered].sort());
export function isRegisteredConfigurationKey(key: unknown): key is string {
  return typeof key === "string" && registered.has(key);
}
export function platformConfigurationArn(key: string) {
  if (!isRegisteredConfigurationKey(key)) throw new Error("Unregistered configuration resource");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "config-item/" + key,
  });
}
export function isSupportConfigurationKey(key: string) {
  return Object.values(CONFIG_KEYS.SUPPORT_AI).some((value) => value === key);
}
