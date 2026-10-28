import type { ResourceResolver } from "./resource-resolvers";
import { isAiRequestLogResourceId, platformAiRequestLogArn } from "../resources/platform-ai-request-log-resources";
export const platformAiRequestLogResourceResolver: ResourceResolver = ({ request }) =>
  isAiRequestLogResourceId(request.params.id) ? platformAiRequestLogArn(request.params.id) : undefined;
