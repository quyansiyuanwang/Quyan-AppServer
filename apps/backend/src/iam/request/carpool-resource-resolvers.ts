import { CarpoolRepository } from "@/store/billing/carpool.repository";
import type { ResourceResolver } from "./resource-resolvers";
import { buildAcsResource } from "@quyan/shared";

/** Resolves an order only when the authenticated subject has a persisted membership. */
export const carpoolOrderResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const orderId = request.params.id;
  if (typeof orderId !== "string" || !/^[A-Za-z0-9_-]{1,50}$/.test(orderId)) return undefined;

  const order = await CarpoolRepository.getInstance().findOrder(orderId);
  if (!order || order.id !== orderId || !order.members.some((member) => member.userId === principal.subjectUserId))
    return undefined;

  return buildAcsResource({
    service: "carpool",
    region: "*",
    accountId: principal.accountOwnerId,
    path: `order/${orderId}`,
  });
};
