import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
/** Resource identity is the logical request row, not an ambiguous client request label. */
export function isRelayLogicalRequestId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function platformRelayRequestArn(id: string) {
  if (!isRelayLogicalRequestId(id)) throw new Error("Invalid logical request identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-request/" + id,
  });
}
