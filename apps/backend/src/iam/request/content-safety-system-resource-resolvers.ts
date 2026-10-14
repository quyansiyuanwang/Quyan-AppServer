import type { ResourceResolver } from "./resource-resolvers";
import { contentSafetySystemConfigArn } from "../resources/content-safety-system-resources";
/** Shared system configuration is a server-fixed platform resource, never a client-selected namespace. */
export const contentSafetySystemConfigResourceResolver: ResourceResolver = () => contentSafetySystemConfigArn();
