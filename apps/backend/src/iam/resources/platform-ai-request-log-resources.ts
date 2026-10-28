import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isAiRequestLogResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
}
export function platformAiRequestLogArn(id: string): string {
  if (!isAiRequestLogResourceId(id)) throw new Error("Invalid AI request log identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "relay-ai-request-log/" + id,
  });
}
