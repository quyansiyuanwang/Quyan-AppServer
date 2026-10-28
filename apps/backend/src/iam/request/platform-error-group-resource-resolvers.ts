import type { ResourceResolver } from "./resource-resolvers";
import { isErrorGroupResourceId, platformErrorGroupArn } from "../resources/platform-error-group-resources";
export const platformErrorGroupResourceResolver: ResourceResolver = ({ request }) =>
  isErrorGroupResourceId(request.params.id) ? platformErrorGroupArn(request.params.id) : undefined;
