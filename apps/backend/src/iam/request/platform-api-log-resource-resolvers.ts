import { isApiLogResourceId, platformApiLogArn } from "../resources/platform-api-log-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const platformApiLogResourceResolver: ResourceResolver = ({ request }) =>
  isApiLogResourceId(request.params.logId) ? platformApiLogArn(request.params.logId) : undefined;
