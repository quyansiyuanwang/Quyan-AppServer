import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isApiLogResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value) && value === value.trim();
}
export function platformApiLogArn(id: string): string {
  if (!isApiLogResourceId(id)) throw new Error("Invalid API log identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "api-request-log/" + id,
  });
}
