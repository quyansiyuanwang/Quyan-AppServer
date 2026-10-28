import { buildAcsResource } from "@quyan/shared";

export function isCanonicalTicketId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}
export function ticketArn(accountOwnerId: string, userId: string, ticketId: string): string {
  if (!isCanonicalTicketId(userId) || !isCanonicalTicketId(ticketId)) throw new Error("Invalid ticket identifier");
  return buildAcsResource({
    service: "ticket",
    region: "*",
    accountId: accountOwnerId,
    path: "ticket/" + userId + "/" + ticketId,
  });
}
