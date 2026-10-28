import {
  platformRedemptionCodeArn,
  platformRedemptionCodeCollectionArn,
  isRedemptionCodeResourceId,
} from "../resources/platform-redemption-code-resources";
import type { ResourceResolver, BatchResourceResolver } from "./resource-resolvers";
// New IDs are checked inside the issuance transaction before any credentials leave the service.
export const platformRedemptionCodeCreationResourceResolver: BatchResourceResolver = () => [
  platformRedemptionCodeCollectionArn(),
];
export const platformRedemptionCodeResourceResolver: ResourceResolver = ({ request }) => {
  const id = request.params.id;
  return isRedemptionCodeResourceId(id) ? platformRedemptionCodeArn(id) : undefined;
};
