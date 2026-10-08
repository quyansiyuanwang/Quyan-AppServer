import { zodToJsonSchema } from "zod-to-json-schema";
import { IAM_ACTION_DEFINITIONS, IAM_CONDITION_KEY_CATALOG, IAM_RESOURCE_TYPE_CATALOG } from "@quyan/shared";
import { iamPolicyDocumentSchema, IAM_POLICY_LIMITS } from "../parser/policy-schema";
/** Generated from the same Zod validator; custom catalog/ownership refinements require server diagnosis. */
export function getIamPolicyJsonSchema(): Record<string, unknown> {
  return {
    ...zodToJsonSchema(iamPolicyDocumentSchema, {
      name: "QuyanIdentityPolicy",
      target: "jsonSchema7",
      effectStrategy: "input",
    }),
    title: "Quyan RAM identity policy, Version 1",
    description:
      "Effect, Action, Resource and supported Condition clauses. Server diagnosis and delegation checks are required before publishing.",
    "x-quyan-policy-kind": "identity",
    "x-quyan-server-validation-required": true,
    "x-quyan-limits": IAM_POLICY_LIMITS,
    "x-quyan-actions": IAM_ACTION_DEFINITIONS.map((action) => ({
      action: action.action,
      resourceTypes: [...action.resourceTypes],
    })),
    "x-quyan-resource-types": IAM_RESOURCE_TYPE_CATALOG,
    "x-quyan-condition-keys": IAM_CONDITION_KEY_CATALOG.filter((key) => key.supported),
  };
}
