import { upsertQuotaOverrideBodySchema } from "@/api/schema/developer/developer.schema";
import type { ResourceResolver, BatchResourceResolver } from "./resource-resolvers";
import {
  platformDeveloperQuotaArn,
  platformDeveloperQuotaSubjectArn,
  isDeveloperQuotaRecordId,
} from "../resources/platform-developer-quota-resources";
import { PlatformDeveloperQuotaWriteRepository } from "@/store/developer/platform-developer-quota-write.repository";
export const platformDeveloperQuotaUpsertResources: BatchResourceResolver = async ({ request, principal }) => {
  const parsed = upsertQuotaOverrideBodySchema.strict().safeParse(request.body);
  if (!parsed.success) return undefined;
  const preparation = await PlatformDeveloperQuotaWriteRepository.getInstance().prepare(principal, parsed.data);
  const { subject, target } = preparation;
  return [
    platformDeveloperQuotaSubjectArn(subject.subjectType, subject.subjectId, subject.service),
    ...(target ? [platformDeveloperQuotaArn(target.id)] : []),
  ];
};
export const platformDeveloperQuotaDeleteResource: ResourceResolver = async ({ request, principal }) => {
  const id = request.params.id;
  if (!isDeveloperQuotaRecordId(id)) return undefined;
  const target = await PlatformDeveloperQuotaWriteRepository.getInstance().target(principal, id);
  return target ? platformDeveloperQuotaArn(target.id) : undefined;
};
