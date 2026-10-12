import { platformSystemArn } from "../resources/platform-system-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const platformBuildInfoResource: ResourceResolver = () => platformSystemArn("build-info");
export const platformSystemStatisticsResource: ResourceResolver = () => platformSystemArn("stats");
export const platformConsumptionStatisticsResource: ResourceResolver = () => platformSystemArn("consumption-stats");

export const platformTrackingStatisticsResource: ResourceResolver = () => platformSystemArn("tracking-stats");
export const platformFunnelStatisticsResource: ResourceResolver = () => platformSystemArn("tracking-funnel");
export const platformHeatmapResource: ResourceResolver = () => platformSystemArn("heatmap-stats");

export const platformOpenApiSpecificationResource: ResourceResolver = () => platformSystemArn("openapi-spec");
