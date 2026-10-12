import { platformSystemArn } from "../resources/platform-system-resources";
import type { ResourceResolver } from "./resource-resolvers";
export const platformBuildInfoResource: ResourceResolver = () => platformSystemArn("build-info");
export const platformSystemStatisticsResource: ResourceResolver = () => platformSystemArn("stats");
export const platformConsumptionStatisticsResource: ResourceResolver = () => platformSystemArn("consumption-stats");
