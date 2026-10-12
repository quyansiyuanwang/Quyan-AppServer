import type { ResourceResolver } from "./resource-resolvers";
import { PlatformModelPricingWriteRepository } from "@/store/relay/platform-model-pricing-write.repository";
import {
  isModelPricingRecordId,
  platformModelPricingArn,
  platformModelPricingCollectionArn,
} from "../resources/platform-model-pricing-resources";
export const platformModelPricingCreateResource: ResourceResolver = () => platformModelPricingCollectionArn();
export const platformModelPricingWriteResource: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.id;
  if (!isModelPricingRecordId(id)) return undefined;
  const target = await PlatformModelPricingWriteRepository.getInstance().target(principal, id);
  return target ? platformModelPricingArn(target.id) : undefined;
};
