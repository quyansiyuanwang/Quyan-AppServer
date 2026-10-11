import { accountEntityResourceResolver } from "./resource-resolvers";
import type { ResourceResolver } from "./resource-resolvers";

/**
 * Content Safety user APIs accept an optional administrative target. The target
 * is still represented as a user ARN; the service keeps its existing
 * administrative permission and ownership checks for cross-user operations.
 */
export const contentSafetyUserResourceResolver: ResourceResolver = (context) => {
  const { request, principal } = context;
  const bodyTarget = (request.body as { targetUserId?: unknown } | undefined)?.targetUserId;
  const queryTarget = request.query.targetUserId;
  const targetUserId = bodyTarget ?? queryTarget ?? principal.subjectUserId;
  return accountEntityResourceResolver("user", () => targetUserId)(context);
};
