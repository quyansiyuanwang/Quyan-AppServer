import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isRedemptionCodeResourceId(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function platformRedemptionCodeArn(id: string) {
  if (!isRedemptionCodeResourceId(id)) throw new Error("Invalid redemption code resource identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "redemption-code/" + id,
  });
}
export function platformRedemptionCodeCollectionArn() {
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "redemption-code-control/default",
  });
}
