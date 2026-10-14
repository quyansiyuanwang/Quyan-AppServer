import type { BatchResourceResolver } from "./resource-resolvers";
import { iamAuthenticatedUserResourceResolver } from "./resource-resolvers";
import { monthlyPassTemplateArn } from "../resources/monthly-pass-resources";
import { isPlatformLogResourceId } from "../resources/platform-log-resources";
export const monthlyPassPurchaseResources: BatchResourceResolver = async (context) => {
  const templateId = (context.request.body as { templateId?: unknown } | undefined)?.templateId;
  const user = await iamAuthenticatedUserResourceResolver(context);
  return user && isPlatformLogResourceId(templateId)
    ? [user, monthlyPassTemplateArn(context.principal.accountOwnerId, context.principal.subjectUserId, templateId)]
    : undefined;
};
