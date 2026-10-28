import { buildAcsResource } from "@quyan/shared";
export const isCanonicalBalanceTransactionId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
export const balanceTransactionArn = (accountId: string, userId: string, transactionId: string) =>
  buildAcsResource({ service: "balance", region: "*", accountId, path: "transaction/" + userId + "/" + transactionId });
