import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isLegalPolicyVersionId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function platformLegalPolicyArn(id: string) {
  if (!isLegalPolicyVersionId(id)) throw new Error("Invalid legal policy version identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "legal-policy/" + id,
  });
}
