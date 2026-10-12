import { PlatformLegalPolicyPublicationRepository } from "@/store/content/platform-legal-policy-publication.repository";
import type { LegalPolicyPublicationOperation } from "@/store/content/platform-legal-policy-publication.store";
import { getIamActionDefinition } from "@quyan/shared";
import { PlatformLegalPolicyWriteRepository } from "@/store/content/platform-legal-policy-write.repository";
import { createLegalPolicyBodySchema, legalPolicyIdParamsSchema } from "@/api/schema/legal-policy/legal-policy.schema";
import { PlatformLegalPolicyReadRepository } from "@/store/content/platform-legal-policy-read.repository";
import { platformLegalPolicyArn, platformLegalPolicyCreationArn } from "../resources/platform-legal-policy-resources";
import type { ResourceResolver, BatchResourceResolver } from "./resource-resolvers";
export const platformLegalPolicyDetailResource: ResourceResolver = async ({ request, principal }) => {
  const parsed = legalPolicyIdParamsSchema.safeParse(request.params);
  if (!parsed.success) return undefined;
  const target = await PlatformLegalPolicyReadRepository.getInstance().target(principal, parsed.data.id);
  return target ? platformLegalPolicyArn(target.id) : undefined;
};

export const platformLegalPolicyCreateResource: ResourceResolver = ({ request }) => {
  const parsed = createLegalPolicyBodySchema.safeParse(request.body);
  return parsed.success ? platformLegalPolicyCreationArn(parsed.data.policyType) : undefined;
};
const draftResource =
  (operation: "UpdateVersion" | "DeleteVersion"): ResourceResolver =>
  async ({ request, principal }) => {
    const parsed = legalPolicyIdParamsSchema.safeParse(request.params),
      permission = getIamActionDefinition("quyan:legal_policy:" + operation)?.legacyPermission;
    if (!parsed.success || !permission) return undefined;
    const target = await PlatformLegalPolicyWriteRepository.getInstance().target(principal, parsed.data.id, permission);
    return target ? platformLegalPolicyArn(target.id) : undefined;
  };
export const platformLegalPolicyUpdateResource = draftResource("UpdateVersion");
export const platformLegalPolicyDeleteResource = draftResource("DeleteVersion");

const publicationResource =
  (operation: LegalPolicyPublicationOperation): BatchResourceResolver =>
  async ({ request, principal }) => {
    const parsed = legalPolicyIdParamsSchema.safeParse(request.params);
    if (!parsed.success) return undefined;
    const transition = await PlatformLegalPolicyPublicationRepository.getInstance().prepare(
      principal,
      parsed.data.id,
      operation,
    );
    return transition.affected.map((t) => platformLegalPolicyArn(t.id));
  };
export const platformLegalPolicyPublishResources = publicationResource("PublishVersion");
export const platformLegalPolicyUnpublishResources = publicationResource("UnpublishVersion");
