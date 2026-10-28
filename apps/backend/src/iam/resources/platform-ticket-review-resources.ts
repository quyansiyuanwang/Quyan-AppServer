import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isCanonicalTicketId } from "./ticket-resources";
export function platformTicketReviewArn(userId: string, ticketId: string) {
  if (!isCanonicalTicketId(userId) || !isCanonicalTicketId(ticketId)) throw new Error("Invalid ticket review resource");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "ticket-review/" + userId + "/" + ticketId,
  });
}
