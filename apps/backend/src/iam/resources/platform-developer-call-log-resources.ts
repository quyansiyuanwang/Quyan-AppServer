import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isDeveloperCallLogRecordId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function platformDeveloperCallLogArn(id: string) {
  if (!isDeveloperCallLogRecordId(id)) throw new Error("Invalid developer product call log identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "developer-product-call-log/" + id,
  });
}
