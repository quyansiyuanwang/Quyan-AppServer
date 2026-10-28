import type { ResourceResolver } from "./resource-resolvers";
import { supportConfigArn } from "../resources/support-config-resource";
export const supportConfigResourceResolver: ResourceResolver = () => supportConfigArn();
