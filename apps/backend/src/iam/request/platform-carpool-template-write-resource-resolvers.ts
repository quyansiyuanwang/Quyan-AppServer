import type { ResourceResolver, BatchResourceResolver } from "./resource-resolvers";
import { isPlatformLogResourceId } from "../resources/platform-log-resources";
import { platformTemplateArn, platformCarpoolTemplateControlArn } from "../resources/platform-template-resources";
export const platformCarpoolTemplateWriteResource: ResourceResolver = ({ request }) =>
  isPlatformLogResourceId(request.params.id) ? platformTemplateArn("carpool", request.params.id) : undefined;
export const platformCarpoolTemplateCreateResources: BatchResourceResolver = ({ request }) => {
  const id = (request.body as { monthlyPassTemplateId?: unknown } | undefined)?.monthlyPassTemplateId;
  return isPlatformLogResourceId(id)
    ? [platformCarpoolTemplateControlArn(), platformTemplateArn("monthly-pass", id)]
    : undefined;
};
export const platformCarpoolTemplateUpdateResources: BatchResourceResolver = ({ request }) => {
  const id = request.params.id,
    monthlyId = (request.body as { monthlyPassTemplateId?: unknown } | undefined)?.monthlyPassTemplateId;
  return isPlatformLogResourceId(id) && isPlatformLogResourceId(monthlyId)
    ? [platformTemplateArn("carpool", id), platformTemplateArn("monthly-pass", monthlyId)]
    : undefined;
};
export const platformCarpoolTemplateDuplicateResources: BatchResourceResolver = ({ request }) =>
  isPlatformLogResourceId(request.params.id)
    ? [platformCarpoolTemplateControlArn(), platformTemplateArn("carpool", request.params.id)]
    : undefined;
