import { z } from "zod";
import { IAM_CONDITION_OPERATORS, getIamConditionKey } from "@quyan/shared";
import { validIpConditionValue } from "./ip-condition";
export const IAM_CONDITION_LIMITS = Object.freeze({ keys: 32, values: 50, valueLength: 512 });
export function conditionBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}
export function conditionNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value))
    return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}
const date = z.string().datetime({ offset: true });
export function conditionDate(value: unknown): number | undefined {
  return typeof value === "string" && date.safeParse(value).success ? Date.parse(value) : undefined;
}
const scalar = z.union([
  z
    .string()
    .max(IAM_CONDITION_LIMITS.valueLength)
    .refine((value) => [...value].every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127)),
  z.number().finite(),
  z.boolean(),
]);
const values = z.union([scalar, z.array(scalar).min(1).max(IAM_CONDITION_LIMITS.values)]);
const block = z
  .record(z.string(), values)
  .refine(
    (value) => Object.keys(value).length > 0 && Object.keys(value).length <= IAM_CONDITION_LIMITS.keys,
    "Empty or oversized condition clause",
  );
export const iamConditionSchema = z
  .record(z.enum(IAM_CONDITION_OPERATORS), block)
  .refine((value) => Object.keys(value).length > 0, "Empty Condition")
  .superRefine((condition, context) => {
    for (const [operator, clause] of Object.entries(condition))
      for (const [key, value] of Object.entries(clause)) {
        const definition = getIamConditionKey(key);
        if (
          !definition?.supported ||
          !definition.operators.includes(operator as (typeof IAM_CONDITION_OPERATORS)[number])
        ) {
          context.addIssue({ code: "custom", path: [operator, key], message: "Unsupported condition key or operator" });
          continue;
        }
        for (const item of [value].flat()) {
          const valid =
            operator === "Null" || operator === "Bool"
              ? conditionBoolean(item) !== undefined
              : operator.startsWith("Numeric")
                ? conditionNumber(item) !== undefined
                : operator.startsWith("Date")
                  ? conditionDate(item) !== undefined
                  : operator.includes("IpAddress")
                    ? typeof item === "string" && validIpConditionValue(item)
                    : typeof item === "string";
          if (!valid) context.addIssue({ code: "custom", path: [operator, key], message: "Invalid condition value" });
        }
      }
  });
