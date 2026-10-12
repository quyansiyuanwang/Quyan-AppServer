import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
export function isCanonicalMaintenanceRunId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(value);
}
export function platformMaintenanceRunArn(id: string) {
  if (!isCanonicalMaintenanceRunId(id)) throw new Error("Invalid maintenance run identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "maintenance-run/" + id,
  });
}
