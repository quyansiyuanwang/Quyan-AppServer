import type { ResourceResolver, BatchResourceResolver } from "./resource-resolvers";
import {
  contentSafetySystemConfigArn,
  contentSafetySystemRuleControlArn,
  contentSafetySystemRuleArn,
  isContentSafetyRuleId,
} from "../resources/content-safety-system-resources";
/** Shared system configuration is a server-fixed platform resource, never a client-selected namespace. */
export const contentSafetySystemConfigResourceResolver: ResourceResolver = () => contentSafetySystemConfigArn();

export const contentSafetySystemRuleControlResourceResolver: ResourceResolver = () =>
  contentSafetySystemRuleControlArn();
export const contentSafetySystemRuleResourceResolver: ResourceResolver = ({ request }) => {
  const id = request.params.id;
  if (!isContentSafetyRuleId(id)) return undefined;
  return contentSafetySystemRuleArn(id);
};
export const contentSafetySystemRuleBatchResourceResolver: BatchResourceResolver = ({ request }) => {
  const ids = (request.body as { ids?: unknown })?.ids;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => !isContentSafetyRuleId(id)) ||
    new Set(ids).size !== ids.length
  )
    return undefined;
  return ids.map(contentSafetySystemRuleArn);
};
