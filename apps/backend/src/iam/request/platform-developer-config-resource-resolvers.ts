import { isDeveloperProductCode } from "@quyan/shared";
import type { BatchResourceResolver } from "./resource-resolvers";
import {
  platformDeveloperConfigArn,
  platformDeveloperConfigControlArn,
} from "../resources/platform-developer-config-resources";
import { PlatformDeveloperConfigWriteRepository } from "@/store/developer/platform-developer-config-write.repository";
export const platformDeveloperConfigUpsertResources: BatchResourceResolver = async ({ request, principal }) => {
  const product = request.params.product;
  if (typeof product !== "string" || !isDeveloperProductCode(product)) return undefined;
  const target = await PlatformDeveloperConfigWriteRepository.getInstance().target(principal, product);
  return [platformDeveloperConfigControlArn(product), ...(target ? [platformDeveloperConfigArn(target.id)] : [])];
};
