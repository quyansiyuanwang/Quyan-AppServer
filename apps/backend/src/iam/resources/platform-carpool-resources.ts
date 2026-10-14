import { buildAcsResource, IAM_PLATFORM_ACCOUNT_ID } from "@quyan/shared";
import { isPlatformLogResourceId } from "./platform-log-resources";
export function platformCarpoolOrderArn(id: string) {
  if (!isPlatformLogResourceId(id)) throw new Error("Invalid carpool order identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "carpool-order/" + id,
  });
}

export function platformCarpoolRefundAccountArn(userId: string) {
  if (!isPlatformLogResourceId(userId)) throw new Error("Invalid refund account identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "balance-account/" + userId,
  });
}
export function platformCarpoolRefundLedgerArn(userId: string, id: string) {
  if (![userId, id].every(isPlatformLogResourceId)) throw new Error("Invalid refund ledger identity");
  return buildAcsResource({
    service: "platform",
    region: "*",
    accountId: IAM_PLATFORM_ACCOUNT_ID,
    path: "balance-transaction/" + userId + "/" + id,
  });
}
