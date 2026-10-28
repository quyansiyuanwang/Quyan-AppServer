import { isDeveloperProductCode } from "@quyan/shared";
import type { ResourceResolver } from "./resource-resolvers";
import {
  platformDeveloperAccountArn,
  isDeveloperAccountRecordId,
} from "../resources/platform-developer-account-resources";
import { PlatformDeveloperUsageReadRepository } from "@/store/developer/platform-developer-usage-read.repository";
export const platformDeveloperUsageAccountResource: ResourceResolver = async ({ request, principal }) => {
  const { product, accountId } = request.params;
  if (typeof product !== "string" || !isDeveloperProductCode(product) || !isDeveloperAccountRecordId(accountId))
    return undefined;
  const target = await PlatformDeveloperUsageReadRepository.getInstance().target(principal, product, { accountId });
  return target ? platformDeveloperAccountArn(target.id) : undefined;
};
export const platformDeveloperUsageUserResource: ResourceResolver = async ({ request, principal }) => {
  const { product, userId } = request.params;
  if (typeof product !== "string" || !isDeveloperProductCode(product) || !isDeveloperAccountRecordId(userId))
    return undefined;
  const target = await PlatformDeveloperUsageReadRepository.getInstance().target(principal, product, { userId });
  return target ? platformDeveloperAccountArn(target.id) : undefined;
};
