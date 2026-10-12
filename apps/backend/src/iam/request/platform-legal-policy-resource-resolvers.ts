import { legalPolicyIdParamsSchema } from "@/api/schema/legal-policy/legal-policy.schema";
import { PlatformLegalPolicyReadRepository } from "@/store/content/platform-legal-policy-read.repository";
import { platformLegalPolicyArn } from "../resources/platform-legal-policy-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const platformLegalPolicyDetailResource: ResourceResolver = async ({ request, principal }) => {
  const parsed = legalPolicyIdParamsSchema.safeParse(request.params);
  if (!parsed.success) return undefined;
  const target = await PlatformLegalPolicyReadRepository.getInstance().target(principal, parsed.data.id);
  return target ? platformLegalPolicyArn(target.id) : undefined;
};
