import { buildAcsResource } from "@quyan/shared";

export function isCanonicalBalanceId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

export function balanceGiftCodeArn(accountOwnerId: string, userId: string, giftCodeId: string): string {
  if (!isCanonicalBalanceId(userId) || !isCanonicalBalanceId(giftCodeId))
    throw new Error("Invalid balance gift code resource identifier");
  return buildAcsResource({
    service: "balance",
    region: "*",
    accountId: accountOwnerId,
    path: "gift-code/" + userId + "/" + giftCodeId,
  });
}
