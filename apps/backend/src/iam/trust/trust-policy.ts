import { createHash } from "node:crypto";
import { z } from "zod";
import {
  actionForPermission,
  Permission,
  getIamResourcePatternTypes,
  getIamResourceType,
  buildAcsResource,
} from "@quyan/shared";
import type {
  IamEvaluationResult,
  IamPrincipal,
  IamConditionContext,
  NormalizedIamTrustPolicyDocument,
} from "@quyan/shared";
import { IAM_POLICY_LIMITS, iamStatementFieldsSchema } from "../parser/policy-schema";
import { readIamPolicyJson, IamPolicyValidationError } from "../parser/policy-parser";
import { normalizeIamPolicy } from "../parser/policy-normalizer";
import { evaluatePolicies } from "../evaluator/policy-evaluator";
export const IAM_ASSUME_ROLE_ACTION = actionForPermission(Permission.RAM_ASSUME_ROLE);
export const iamPrincipalSelectorSchema = z
  .object({
    RAM: z.union([
      z
        .string()
        .trim()
        .regex(/^acs:quyan::[A-Za-z0-9_-]{1,128}:user\/[A-Za-z0-9_-]{1,128}$/),
      z
        .array(
          z
            .string()
            .trim()
            .regex(/^acs:quyan::[A-Za-z0-9_-]{1,128}:user\/[A-Za-z0-9_-]{1,128}$/),
        )
        .min(1)
        .max(IAM_POLICY_LIMITS.patterns),
    ]),
  })
  .strict();
export const iamTrustStatementSchema = iamStatementFieldsSchema
  .extend({ Principal: iamPrincipalSelectorSchema })
  .strict()
  .superRefine((statement, context) => {
    if ([statement.Action].flat().some((action) => action !== IAM_ASSUME_ROLE_ACTION))
      context.addIssue({ code: "custom", path: ["Action"], message: "Trust policies require the AssumeRole action" });
    [statement.Resource].flat().forEach((resource, index) => {
      if (resource !== "*" && getIamResourcePatternTypes(resource).some((type) => type.id !== "quyan/role"))
        context.addIssue({
          code: "custom",
          path: Array.isArray(statement.Resource) ? ["Resource", index] : ["Resource"],
          message: "Trust policies require role resources",
        });
    });
  });
export const iamTrustPolicyDocumentSchema = z
  .object({
    Version: z.literal("1"),
    Statement: z.union([
      iamTrustStatementSchema,
      z.array(iamTrustStatementSchema).min(1).max(IAM_POLICY_LIMITS.statements),
    ]),
  })
  .strict();
export function parseIamTrustPolicy(input: unknown) {
  const parsed = iamTrustPolicyDocumentSchema.safeParse(readIamPolicyJson(input));
  if (!parsed.success) throw new IamPolicyValidationError();
  const statements = [parsed.data.Statement].flat().map((statement) => ({
    ...normalizeIamPolicy({
      Version: "1",
      Statement: {
        Sid: statement.Sid,
        Effect: statement.Effect,
        Action: statement.Action,
        Resource: statement.Resource,
        Condition: statement.Condition,
      },
    }).Statement[0],
    Principal: { RAM: [...new Set([statement.Principal.RAM].flat())].sort() },
  }));
  const canonicalStatements = [
    ...new Map(statements.map((statement) => [JSON.stringify(statement), statement])).entries(),
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const document: NormalizedIamTrustPolicyDocument = {
    Version: "1",
    Statement: canonicalStatements.map(([, statement]) => statement),
  };
  const canonicalJson = JSON.stringify(document);
  return { document, canonicalJson, documentHash: createHash("sha256").update(canonicalJson).digest("hex") };
}
export function principalIamArn(principal: IamPrincipal): string | undefined {
  if (
    !["root", "sub_user", "access_key"].includes(principal.subjectType) ||
    principal.subjectUserId !== principal.principalUserId ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(principal.principalUserId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(principal.accountOwnerId)
  )
    return undefined;
  return buildAcsResource({
    service: "quyan",
    region: "",
    accountId: principal.accountOwnerId,
    path: "user/" + principal.principalUserId,
  });
}
export function evaluateIamTrustPolicy(
  input: unknown,
  request: { principal: IamPrincipal; roleArn: string; context?: IamConditionContext },
): IamEvaluationResult {
  const document = parseIamTrustPolicy(input).document;
  const principalArn = principalIamArn(request.principal);
  if (
    !principalArn ||
    getIamResourceType(request.roleArn)?.id !== "quyan/role" ||
    request.roleArn.split(":")[4].includes("*") ||
    request.roleArn.split(":")[3] !== request.principal.accountOwnerId
  )
    return { decision: "ImplicitDeny", reason: "invalid-request", matchedStatements: [] };
  const identity = document.Statement.flatMap((statement, index) => {
    if (!statement.Principal.RAM.includes(principalArn)) return [];
    const { Principal: _principal, ...fields } = statement;
    return [{ ...fields, Sid: fields.Sid ?? String(index) }];
  });
  if (!identity.length) return { decision: "ImplicitDeny", reason: "no-matching-allow", matchedStatements: [] };
  return evaluatePolicies(
    [
      {
        policyId: "role-trust:" + request.roleArn.split(":")[4].slice("role/".length),
        document: { Version: "1", Statement: identity },
      },
    ],
    { action: IAM_ASSUME_ROLE_ACTION, resource: request.roleArn, context: request.context },
  );
}

/** Trust grants never replace identity grants; either side's explicit Deny wins. */
export function combineIamIdentityAndTrust(
  identity: IamEvaluationResult,
  trust: IamEvaluationResult,
): IamEvaluationResult {
  const matchedStatements = [...identity.matchedStatements, ...trust.matchedStatements];
  if (identity.decision === "ExplicitDeny" || trust.decision === "ExplicitDeny")
    return { decision: "ExplicitDeny", reason: "explicit-deny", matchedStatements };
  if (identity.decision === "Allow" && trust.decision === "Allow")
    return { decision: "Allow", reason: "matched-allow", matchedStatements };
  return {
    decision: "ImplicitDeny",
    reason:
      identity.reason === "missing-condition-context" || trust.reason === "missing-condition-context"
        ? "missing-condition-context"
        : identity.decision !== "Allow"
          ? identity.reason
          : trust.reason,
    matchedStatements,
  };
}
