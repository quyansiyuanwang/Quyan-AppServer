import { PlatformLifecycleHistoryRepository } from "@/store/system/platform-lifecycle-history.repository";
import {
  isCanonicalLifecycleId,
  platformLifecycleRunArn,
  platformLifecycleArtifactArn,
  isLifecycleDataset,
  platformLifecycleDatasetArn,
  platformLifecycleScheduleArn,
} from "../resources/platform-lifecycle-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const platformLifecycleDatasetResourceResolver: ResourceResolver = ({ request }) =>
  isLifecycleDataset(request.params.dataset) ? platformLifecycleDatasetArn(request.params.dataset) : undefined;
export const platformLifecycleScheduleResourceResolver: ResourceResolver = () => platformLifecycleScheduleArn();

export const platformLifecycleRunResourceResolver: ResourceResolver = ({ request }) =>
  isCanonicalLifecycleId(request.params.runId) ? platformLifecycleRunArn(request.params.runId) : undefined;

export const platformLifecycleArtifactResourceResolver: ResourceResolver = async ({ request, principal }) => {
  if (!isCanonicalLifecycleId(request.params.artifactId)) return undefined;
  const target = await PlatformLifecycleHistoryRepository.getInstance().targetDownload(
    principal,
    request.params.artifactId,
  );
  return target && target.id === request.params.artifactId
    ? platformLifecycleArtifactArn(target.lifecycleRunId, target.id)
    : undefined;
};
