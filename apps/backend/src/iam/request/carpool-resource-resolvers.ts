import { createHash } from "node:crypto";
import { CarpoolRepository } from "@/store/billing/carpool.repository";
import { acceptCarpoolInviteBodySchema, createCarpoolOrderBodySchema } from "@/api/schema/billing/carpool.schema";
import type { ResourceResolver, BatchResourceResolver } from "./resource-resolvers";
import { iamAuthenticatedUserResourceResolver } from "./resource-resolvers";
import { carpoolArn, isCanonicalCarpoolId } from "../resources/carpool-resources";

/** Resolves an order only through the authenticated subject's persisted membership. */
export const carpoolOrderResourceResolver: ResourceResolver = async ({ request, principal }) => {
  const orderId = request.params.id;
  if (!isCanonicalCarpoolId(orderId)) return undefined;
  const order = await CarpoolRepository.getInstance().findMemberOrderTarget(
    orderId,
    principal.subjectUserId,
    principal.accountOwnerId,
  );
  if (!order || order.id !== orderId || !order.members.some((member) => member.userId === principal.subjectUserId))
    return undefined;
  return carpoolArn(principal.accountOwnerId, "order", order.id);
};

/** Creation affects the actor and consumes a server-resolved published template. */
export const carpoolCreateOrderResourceResolver: BatchResourceResolver = async (context) => {
  const parsed = createCarpoolOrderBodySchema.safeParse(context.request.body);
  if (!parsed.success || !isCanonicalCarpoolId(parsed.data.packageTemplateId)) return undefined;
  const template = await CarpoolRepository.getInstance().findPublishedTemplate(parsed.data.packageTemplateId);
  const user = await iamAuthenticatedUserResourceResolver(context);
  if (!user || !template || template.id !== parsed.data.packageTemplateId) return undefined;
  return [user, carpoolArn(context.principal.accountOwnerId, "template", template.id)];
};

/** Invite tokens are never ARNs or logged: a valid token only identifies the target of IAM evaluation. */
export const carpoolAcceptInviteResourceResolver: BatchResourceResolver = async (context) => {
  const parsed = acceptCarpoolInviteBodySchema.safeParse(context.request.body);
  if (!parsed.success) return undefined;
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const invite = await CarpoolRepository.getInstance().findUsableInviteOrder(tokenHash, new Date());
  const user = await iamAuthenticatedUserResourceResolver(context);
  if (!user || !invite || !isCanonicalCarpoolId(invite.orderId)) return undefined;
  return [user, carpoolArn(context.principal.accountOwnerId, "order", invite.orderId)];
};
