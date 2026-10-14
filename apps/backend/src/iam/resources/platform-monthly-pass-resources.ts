import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isPlatformLogResourceId } from "./platform-log-resources";
export function platformMonthlyPassUsageArn(userId: string, passId: string, id: string) {
  if (![userId, passId, id].every(isPlatformLogResourceId)) throw new Error("Invalid monthly pass usage identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: `monthly-pass-usage/${userId}/${passId}/${id}`,
  });
}
