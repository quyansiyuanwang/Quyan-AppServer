import { isDeveloperProductCode } from "@quyan/shared";
import type { BatchResourceResolver } from "./resource-resolvers";
import {
  platformDeveloperAccountArn,
  platformDeveloperAccountScopeArn,
  isDeveloperAccountRecordId,
} from "../resources/platform-developer-account-resources";
import { PlatformDeveloperAccountWriteRepository } from "@/store/developer/platform-developer-account-write.repository";
export const platformDeveloperAccountUpsertResources: BatchResourceResolver = async ({ request, principal }) => {
  const { product, userId } = request.params;
  if (typeof product !== "string" || !isDeveloperProductCode(product) || !isDeveloperAccountRecordId(userId))
    return undefined;
  const { target } = await PlatformDeveloperAccountWriteRepository.getInstance().prepare(principal, product, userId);
  return [
    platformDeveloperAccountScopeArn(userId, product),
    ...(target ? [platformDeveloperAccountArn(target.id)] : []),
  ];
};
