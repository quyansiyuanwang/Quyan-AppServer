import type { ResourceResolver, BatchResourceResolver } from "./resource-resolvers";
import { isPlatformLogResourceId } from "../resources/platform-log-resources";
import { platformUserArn } from "../resources/platform-user-resources";
import { platformTemplateArn } from "../resources/platform-template-resources";
export const platformMonthlyPassAssignResources: BatchResourceResolver = ({ request }) => {
  const body = request.body as { userId?: unknown; templateId?: unknown } | undefined;
  const userId = body?.userId,
    templateId = body?.templateId;
  return isPlatformLogResourceId(userId) && isPlatformLogResourceId(templateId)
    ? [platformUserArn(userId), platformTemplateArn("monthly-pass", templateId)]
    : undefined;
};

/** Batch service resolves and authorizes each target independently; route checks the common template. */
export const platformMonthlyPassBatchAssignTemplateResource: ResourceResolver = ({ request }) => {
  const id = (request.body as { templateId?: unknown } | undefined)?.templateId;
  return isPlatformLogResourceId(id) ? platformTemplateArn("monthly-pass", id) : undefined;
};
