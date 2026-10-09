import { z } from "zod";
import {
  IAM_ACTION_CATALOG,
  getIamActionDefinition,
  getIamResourcePatternTypes,
  resolveIamStatementActions,
} from "@quyan/shared";
import { iamConditionSchema } from "../condition/condition-schema";
import { matchIamPattern } from "../evaluator/wildcard-matcher";
export const IAM_POLICY_LIMITS = Object.freeze({
  bytes: 262144,
  statements: 100,
  patterns: 500,
  patternLength: 512,
  depth: 8,
  nodes: 100500,
});
const pattern = z
  .string()
  .trim()
  .min(1)
  .max(IAM_POLICY_LIMITS.patternLength)
  .refine(
    (value) =>
      !/[\s?]/u.test(value) && [...value].every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127),
    "Invalid policy pattern",
  );
const action = pattern
  .refine((value) => /^[A-Za-z0-9_*.-]+(?::[A-Za-z0-9_*.-]+)*$/.test(value), "Invalid action pattern")
  .refine((value) => IAM_ACTION_CATALOG.some((action) => matchIamPattern(value, action)), "Unknown platform action");
const resource = pattern
  .refine(
    (value) => value === "*" || /^acs:[a-z0-9*-]+:[A-Za-z0-9_*-]*:[A-Za-z0-9_*-]+:[A-Za-z0-9_.+/@*-]+$/.test(value),
    "Invalid ACS resource pattern",
  )
  .refine((value) => getIamResourcePatternTypes(value).length > 0, "Unregistered platform resource");
const oneOrMany = (schema: typeof pattern | typeof action | typeof resource) =>
  z.union([schema, z.array(schema).min(1).max(IAM_POLICY_LIMITS.patterns)]);
const commonStatementFieldsSchema = z
  .object({
    Sid: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    Effect: z.enum(["Allow", "Deny"]),
    Resource: oneOrMany(resource),
    Condition: iamConditionSchema.optional(),
  })
  .strict();
export const iamStatementFieldsSchema = commonStatementFieldsSchema.extend({ Action: oneOrMany(action) }).strict();
const iamNotActionStatementFieldsSchema = commonStatementFieldsSchema.extend({ NotAction: oneOrMany(action) }).strict();
export const iamStatementSchema = z
  .union([iamStatementFieldsSchema, iamNotActionStatementFieldsSchema])
  .superRefine((statement, context) => {
    const actions = resolveIamStatementActions(statement);
    if (!actions.length || actions.length > IAM_POLICY_LIMITS.patterns) {
      context.addIssue({
        code: "custom",
        path: ["NotAction"],
        message: "NotAction expansion is empty or exceeds capacity",
      });
      return;
    }
    const conditionKeys = Object.values(statement.Condition ?? {}).flatMap((clause) => Object.keys(clause));
    for (const key of new Set(conditionKeys))
      if (
        IAM_ACTION_CATALOG.some(
          (action) =>
            actions.some((pattern) => matchIamPattern(pattern, action)) &&
            !getIamActionDefinition(action)!.conditionKeys.includes(key),
        )
      )
        context.addIssue({ code: "custom", path: ["Condition"], message: "Condition key is incompatible with Action" });
    const resources = [statement.Resource].flat();
    resources.forEach((resource, index) => {
      const types = getIamResourcePatternTypes(resource);
      if (!types.length) return;
      const compatible = IAM_ACTION_CATALOG.some(
        (action) =>
          actions.some((pattern) => matchIamPattern(pattern, action)) &&
          types.some((type) => getIamActionDefinition(action)!.resourceTypes.includes(type.id)),
      );
      if (!compatible)
        context.addIssue({
          code: "custom",
          path: Array.isArray(statement.Resource) ? ["Resource", index] : ["Resource"],
          message:
            statement.Effect === "Deny"
              ? "Unreachable Deny resource type"
              : "Action and resource types are incompatible",
        });
    });
  });
export const iamPolicyDocumentSchema = z
  .object({
    Version: z.literal("1"),
    Statement: z.union([iamStatementSchema, z.array(iamStatementSchema).min(1).max(IAM_POLICY_LIMITS.statements)]),
  })
  .strict();
