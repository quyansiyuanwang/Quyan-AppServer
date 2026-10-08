import type { IamResourceKind } from "@quyan/shared";
import type { ResourceResolver } from "./resource-resolvers";
export interface IamAuthorizationDefinition {
  action: string;
  resourceKind: Exclude<IamResourceKind, "batch">;
  resource: ResourceResolver;
}
