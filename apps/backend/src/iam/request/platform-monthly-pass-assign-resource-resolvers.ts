import type { BatchResourceResolver } from "./resource-resolvers";
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
