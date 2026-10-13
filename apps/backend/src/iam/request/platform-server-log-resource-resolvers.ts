import { isServerLogResourceName, platformServerLogArn } from "../resources/platform-server-log-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const platformServerLogFileResourceResolver: ResourceResolver = ({ request }) =>
  isServerLogResourceName(request.params.fileName) ? platformServerLogArn(request.params.fileName) : undefined;
