import { z } from "zod";
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
  .refine((value) => !/[\s?]/u.test(value) && [...value].every(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127), "Invalid policy pattern");
const action = pattern.refine(
  (value) => /^[A-Za-z0-9_*.-]+(?::[A-Za-z0-9_*.-]+)*$/.test(value),
  "Invalid action pattern",
);
const resource = pattern.refine(
  (value) => value === "*" || /^acs:[a-z0-9*-]+:[A-Za-z0-9_*-]*:[A-Za-z0-9_*-]+:[A-Za-z0-9_.+/@*-]+$/.test(value),
  "Invalid ACS resource pattern",
);
const oneOrMany = (schema: typeof pattern | typeof action | typeof resource) =>
  z.union([schema, z.array(schema).min(1).max(IAM_POLICY_LIMITS.patterns)]);
export const iamStatementSchema = z
  .object({
    Sid: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    Effect: z.enum(["Allow", "Deny"]),
    Action: oneOrMany(action),
    Resource: oneOrMany(resource),
  })
  .strict();
export const iamPolicyDocumentSchema = z
  .object({
    Version: z.literal("1"),
    Statement: z.union([iamStatementSchema, z.array(iamStatementSchema).min(1).max(IAM_POLICY_LIMITS.statements)]),
  })
  .strict();
