import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isErrorGroupResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
}
export function platformErrorGroupArn(id: string): string {
  if (!isErrorGroupResourceId(id)) throw new Error("Invalid error group identifier");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "error-group/" + id,
  });
}
