import { balanceAccountArn } from "../resources/balance-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const relayProviderClaimBalanceResourceResolver: ResourceResolver = ({ principal }) =>
  balanceAccountArn(principal.accountOwnerId, principal.subjectUserId);
