import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
const resource = (path: string) =>
  buildAcsResource({ service: "platform", region: "*", accountId: IAM_PLATFORM_ACCOUNT_ID, path });
export const platformRelayUptimeArn = () => resource("relay-uptime-control/default");
export const isRelayUptimeMonitorId = (id: unknown): id is string =>
  typeof id === "string" && id.trim() === id && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id);
export function platformRelayUptimeMonitorArn(id: string) {
  if (!isRelayUptimeMonitorId(id)) throw new Error("Invalid monitoring resource identifier");
  return resource("relay-uptime-monitor/" + id);
}
