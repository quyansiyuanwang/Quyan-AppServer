import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isDeveloperQuotaRecordId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function platformDeveloperQuotaArn(id: string) {
  if (!isDeveloperQuotaRecordId(id)) throw new Error("Invalid developer quota override record identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "developer-quota-override/" + id,
  });
}

export function platformDeveloperQuotaSubjectArn(subjectType: string, subjectId: string, service: string) {
  if (
    !["user", "project"].includes(subjectType) ||
    !isDeveloperQuotaRecordId(subjectId) ||
    !["*", "verification", "ip", "push"].includes(service)
  )
    throw new Error("Invalid quota subject");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "developer-quota-subject/" + subjectType + "/" + subjectId + "/" + (service === "*" ? "all" : service),
  });
}
