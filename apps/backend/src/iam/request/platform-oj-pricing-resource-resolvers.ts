import type { ResourceResolver } from "./resource-resolvers";
import { ojPricingModelParamsSchema } from "@/api/schema/oj-submitter/oj-submitter.schema";
import { PlatformOjPricingReadRepository } from "@/store/oj-submitter/platform-oj-pricing-read.repository";
import { platformOjPricingArn } from "../resources/platform-oj-pricing-resources";
export const platformOjPricingDetailResource: ResourceResolver = async ({ request, principal }) => {
  const parsed = ojPricingModelParamsSchema.safeParse(request.params);
  if (!parsed.success) return undefined;
  const target = await PlatformOjPricingReadRepository.getInstance().target(principal, parsed.data.model);
  return target ? platformOjPricingArn(target.id) : undefined;
};
