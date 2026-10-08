import type { IamResourceKind } from "@quyan/shared";
import type { ResourceResolver, BatchResourceResolver } from "./resource-resolvers";
export type IamAuthorizationDefinition = { action: string } & (
  | { resourceKind: Exclude<IamResourceKind, "batch">; resource: ResourceResolver }
  | { resourceKind: "batch"; resource: BatchResourceResolver }
);
