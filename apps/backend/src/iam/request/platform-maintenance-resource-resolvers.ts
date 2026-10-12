import type { ResourceResolver } from "./resource-resolvers";
import { isCanonicalMaintenanceRunId, platformMaintenanceRunArn } from "../resources/platform-maintenance-resources";
export const platformMaintenanceRunResourceResolver: ResourceResolver = ({ request }) =>
  isCanonicalMaintenanceRunId(request.params.runId) ? platformMaintenanceRunArn(request.params.runId) : undefined;
