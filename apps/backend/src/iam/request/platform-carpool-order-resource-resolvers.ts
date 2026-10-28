import type { ResourceResolver } from "./resource-resolvers";
import { isPlatformLogResourceId } from "../resources/platform-log-resources";
import { platformCarpoolOrderArn } from "../resources/platform-carpool-resources";
export const platformCarpoolOrderResource: ResourceResolver = ({ request }) =>
  isPlatformLogResourceId(request.params.id) ? platformCarpoolOrderArn(request.params.id) : undefined;
