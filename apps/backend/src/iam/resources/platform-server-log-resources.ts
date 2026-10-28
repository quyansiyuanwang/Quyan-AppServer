import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID, IAM_SERVER_LOG_FILE_NAME_PATTERN } from "@quyan/shared";
export function isServerLogResourceName(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && IAM_SERVER_LOG_FILE_NAME_PATTERN.test(value);
}
export function platformServerLogArn(fileName: string): string {
  if (!isServerLogResourceName(fileName)) throw new Error("Invalid server log filename");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "server-log-file/" + fileName,
  });
}
