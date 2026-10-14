import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isPlatformUserId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function platformUserArn(id: string) {
  if (!isPlatformUserId(id)) throw new Error("Invalid platform user identifier");
  return buildAcsResource({ service: "platform", region: "*", accountId: IAM_PLATFORM_ACCOUNT_ID, path: "user/" + id });
}
