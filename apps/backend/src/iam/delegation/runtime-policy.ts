import {
  IAM_ACTION_DEFINITIONS,
  IAM_RESOURCE_TYPE_CATALOG,
  IAM_PLATFORM_ACCOUNT_ID,
  matchIamPattern,
} from "@quyan/shared";
import type { NormalizedIamPolicyDocument } from "@quyan/shared";
import type { IamPolicyInput } from "../evaluator/policy-evaluator";
import { IAM_POLICY_LIMITS } from "../parser/policy-schema";
import { parseIamPolicy } from "../parser/policy-parser";
import { isProvenPatternSubset } from "./delegation-check";
import { projectScopedPolicyForDelegation } from "./scoped-policy";

type Statement = NormalizedIamPolicyDocument["Statement"][number];
/** A sufficient intersection proof. Unknown Allow intersections confer no delegatable authority. */
function intersectResource(pattern: string, boundary: string): string | undefined {
  if (isProvenPatternSubset(pattern, boundary)) return pattern;
  if (isProvenPatternSubset(boundary, pattern)) return boundary;
  return undefined;
}
/**
 * Project grants to the same account/type/global-group boundary used for live requests.
 * This is an upper bound for delegation, never a substitute for resource ownership or live authorization.
 * Scoped relations are intersected first. Denies remain conservative and are never truncated.
 */
export function projectRuntimePoliciesForDelegation(
  inputs: readonly IamPolicyInput[],
  accountOwnerId: string,
  qualifiedPlatformActions: ReadonlySet<string>,
): NormalizedIamPolicyDocument[] {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountOwnerId)) throw new Error("Invalid delegation account");
  const statements: Statement[] = [];
  for (const input of inputs) {
    const parsed = parseIamPolicy(input.document).document;
    const scoped = projectScopedPolicyForDelegation({ ...input, document: parsed });
    if (!scoped) continue;
    for (const statement of scoped.Statement) {
      if (statement.Effect === "Deny") {
        // Broader denies only restrict a proof. Retain even intersections we cannot establish.
        statements.push(statement);
        continue;
      }
      const groups = new Map<string, Statement[]>();
      for (const definition of IAM_ACTION_DEFINITIONS) {
        if (!statement.Action.some((pattern) => matchIamPattern(pattern, definition.action))) continue;
        const platform = definition.authorizationBoundary === "platform";
        if (platform && !qualifiedPlatformActions.has(definition.action)) continue;
        const boundaries = IAM_RESOURCE_TYPE_CATALOG.filter(
          (type) => definition.resourceTypes.includes(type.id) && (type.accountScope === "platform") === platform,
        ).map((type) =>
          type.arnTemplate
            .replace("{accountId}", platform ? IAM_PLATFORM_ACCOUNT_ID : accountOwnerId)
            .replace(/\{(?:ancestorId|parentId|resourceId)\}/g, "*"),
        );
        const resources = [
          ...new Set(
            statement.Resource.flatMap((pattern) =>
              boundaries.flatMap((boundary) => {
                const intersection = intersectResource(pattern, boundary);
                return intersection ? [intersection] : [];
              }),
            ),
          ),
        ].sort();
        if (!resources.length) continue;
        // Preserve the original conditions and Sid. Only equivalent resource frames are merged.
        const key = JSON.stringify(resources);
        const entries = groups.get(key) ?? [];
        const group = entries.at(-1);
        if (group && group.Action.length < IAM_POLICY_LIMITS.patterns) group.Action.push(definition.action);
        else entries.push({ ...statement, Action: [definition.action], Resource: resources });
        groups.set(key, entries);
      }
      statements.push(...[...groups.values()].flat());
    }
  }
  // Expansion can exceed the per-document limits. Split without losing any Allow or Deny.
  const documents: NormalizedIamPolicyDocument[] = [];
  let batch: Statement[] = [];
  const flush = () => {
    if (batch.length) documents.push(parseIamPolicy({ Version: "1", Statement: batch }).document);
    batch = [];
  };
  for (const statement of statements) {
    const next = [...batch, statement];
    if (
      next.length > IAM_POLICY_LIMITS.statements ||
      Buffer.byteLength(JSON.stringify({ Version: "1", Statement: next })) > IAM_POLICY_LIMITS.bytes
    )
      flush();
    batch.push(statement);
  }
  flush();
  return documents;
}
