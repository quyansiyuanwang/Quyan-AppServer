import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isIpWhitelistRecordId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function platformIpWhitelistArn(id: string) {
  if (!isIpWhitelistRecordId(id)) throw new Error("Invalid IP whitelist record identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "ip-whitelist/" + id,
  });
}

/** Platform-managed creation boundary; callers cannot supply its account or identifier. */
export function platformIpWhitelistCollectionArn() {
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "ip-whitelist-control/default",
  });
}
