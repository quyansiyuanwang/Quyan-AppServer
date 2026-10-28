import { TicketRepository } from "@/store/ticket/ticket.repository";
import { isCanonicalTicketId, ticketArn } from "../resources/ticket-resources";
import type { ResourceResolver } from "./resource-resolvers";

/** Self-service paths never resolve another user's ticket, even in the same account. */
export const ownTicketResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.id;
  if (!isCanonicalTicketId(id)) return undefined;
  const target = await TicketRepository.getInstance().findOwnTarget(
    id,
    principal.subjectUserId,
    principal.accountOwnerId,
  );
  if (!target || target.id !== id || target.userId !== principal.subjectUserId) return undefined;
  return ticketArn(principal.accountOwnerId, target.userId, target.id);
};
