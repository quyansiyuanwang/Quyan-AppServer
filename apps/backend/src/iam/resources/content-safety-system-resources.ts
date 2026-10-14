import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isContentSafetyRuleId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function contentSafetySystemRuleArn(id: string) {
  if (!isContentSafetyRuleId(id)) throw new Error("Invalid content safety rule identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "content-safety-rule/" + id,
  });
}
export function contentSafetySystemConfigArn() {
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "content-safety-config",
  });
}
