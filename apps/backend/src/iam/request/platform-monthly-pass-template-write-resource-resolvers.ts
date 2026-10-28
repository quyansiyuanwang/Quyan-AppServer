import type { ResourceResolver } from "./resource-resolvers";
import { isPlatformLogResourceId } from "../resources/platform-log-resources";
import { platformTemplateArn, platformMonthlyPassTemplateControlArn } from "../resources/platform-template-resources";
export const platformMonthlyPassTemplateCreateResource: ResourceResolver = () =>
  platformMonthlyPassTemplateControlArn();
export const platformMonthlyPassTemplateWriteResource: ResourceResolver = ({ request }) => {
  const id = request.params.id;
  return isPlatformLogResourceId(id) ? platformTemplateArn("monthly-pass", id) : undefined;
};
