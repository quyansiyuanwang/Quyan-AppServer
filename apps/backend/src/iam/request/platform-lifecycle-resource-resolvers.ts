import {
  isLifecycleDataset,
  platformLifecycleDatasetArn,
  platformLifecycleScheduleArn,
} from "../resources/platform-lifecycle-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const platformLifecycleDatasetResourceResolver: ResourceResolver = ({ request }) =>
  isLifecycleDataset(request.params.dataset) ? platformLifecycleDatasetArn(request.params.dataset) : undefined;
export const platformLifecycleScheduleResourceResolver: ResourceResolver = () => platformLifecycleScheduleArn();
