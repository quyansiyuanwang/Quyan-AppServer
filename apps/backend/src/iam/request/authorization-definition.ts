import { IAM_RESOURCE_KINDS, isKnownIamAction } from "@quyan/shared";
import type { IamResourceKind } from "@quyan/shared";
import type { ResourceResolver, BatchResourceResolver } from "./resource-resolvers";
export type IamAuthorizationDefinition = { action: string } & (
  | { resourceKind: Exclude<IamResourceKind, "batch">; resource: ResourceResolver }
  | { resourceKind: "batch"; resource: BatchResourceResolver }
);

export function assertIamAuthorizationDefinition(definition: IamAuthorizationDefinition): void {
  if (
    !definition ||
    !isKnownIamAction(definition.action) ||
    !IAM_RESOURCE_KINDS.includes(definition.resourceKind) ||
    typeof definition.resource !== "function"
  )
    throw new Error("IAM endpoint requires a catalog action, resource kind and named server resolver");
}
