import { iamTrustPolicyDocumentSchema, IAM_ASSUME_ROLE_ACTION } from "../trust/trust-policy";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  IAM_ACTION_DEFINITIONS,
  IAM_CONDITION_KEY_CATALOG,
  IAM_RESOURCE_TYPE_CATALOG,
  IAM_PLATFORM_ACCOUNT_ID,
} from "@quyan/shared";
import { iamPolicyDocumentSchema, IAM_POLICY_LIMITS } from "../parser/policy-schema";
/** Generated from the same Zod validator; custom catalog/ownership refinements require server diagnosis. */
export function getIamPolicyJsonSchema(policyKind: "identity" | "trust" = "identity"): Record<string, unknown> {
  return {
    ...zodToJsonSchema(policyKind === "trust" ? iamTrustPolicyDocumentSchema : iamPolicyDocumentSchema, {
      name: policyKind === "trust" ? "QuyanTrustPolicy" : "QuyanIdentityPolicy",
      target: "jsonSchema7",
      effectStrategy: "input",
    }),
    title: "Quyan RAM " + policyKind + " policy, Version 1",
    description:
      policyKind === "trust"
        ? "Role trust requires exact RAM Principal, AssumeRole Action, role Resource and supported Condition. Server validation and delegation checks are mandatory."
        : "Effect, exactly one of Action/NotAction, Resource and supported Condition clauses. NotAction is compiled to a finite resource-compatible catalog snapshot. Catalog requiredActions describe additional server checks, not automatic grants; conditionalActions apply only to documented variants. resourceDependencies require separate checks on the indicated source/destination/reference resources, never automatic grants. Server diagnosis and delegation checks are required before publishing.",
    "x-quyan-policy-kind": policyKind,
    "x-quyan-server-validation-required": true,
    "x-quyan-limits": IAM_POLICY_LIMITS,
    "x-quyan-actions": IAM_ACTION_DEFINITIONS.filter(
      (action) => policyKind === "identity" || action.action === IAM_ASSUME_ROLE_ACTION,
    ).map((action) => ({
      action: action.action,
      resourceTypes: [...action.resourceTypes],
      ...(action.authorizationBoundary ? { authorizationBoundary: action.authorizationBoundary } : {}),
      ...(action.platformPermissions ? { platformPermissions: [...action.platformPermissions] } : {}),
      ...(action.resourceDependencies
        ? {
            resourceDependencies: action.resourceDependencies.map((dependency) => ({
              ...dependency,
              resourceTypes: [...dependency.resourceTypes],
            })),
          }
        : {}),
      ...(action.requiredActions ? { requiredActions: [...action.requiredActions] } : {}),
      ...(action.conditionalActions ? { conditionalActions: [...action.conditionalActions] } : {}),
    })),
    "x-quyan-resource-types": IAM_RESOURCE_TYPE_CATALOG.filter(
      (type) => policyKind === "identity" || type.id === "quyan/role",
    ),
    "x-quyan-platform-authorization": {
      namespace: IAM_PLATFORM_ACCOUNT_ID,
      requiresPersistedGlobalManagementGroup: true,
      resourceBoundaryAppliesCeilingOnlyToPlatformResources: true,
      accountPoliciesCannotGrantGroupMembership: true,
    },
    "x-quyan-condition-keys": IAM_CONDITION_KEY_CATALOG.filter((key) => key.supported),
  };
}
