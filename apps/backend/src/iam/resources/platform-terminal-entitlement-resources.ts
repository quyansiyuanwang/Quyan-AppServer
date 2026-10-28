import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isPlatformLogResourceId } from "./platform-log-resources";
function resource(type: string, segments: readonly string[]) {
  if (segments.some((id) => !isPlatformLogResourceId(id))) throw new Error("Invalid terminal resource identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: type + "/" + segments.join("/"),
  });
}
export const platformTerminalEntitlementArn = (userId: string, id: string) =>
  resource("remote-terminal-entitlement", [userId, id]);
export const platformTerminalBindingArn = (userId: string, id: string) =>
  resource("remote-terminal-device-binding", [userId, id]);
export const platformTerminalRegistrationTokenArn = (userId: string, entitlementId: string, id: string) =>
  resource("remote-terminal-registration-token", [userId, entitlementId, id]);
