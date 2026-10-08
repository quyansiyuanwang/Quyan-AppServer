import type { IamPolicyDocument, NormalizedIamPolicyDocument } from "@quyan/shared";
const patterns = (value: string | string[]) =>
  [...new Set((Array.isArray(value) ? value : [value]).map((item) => item.trim()))].sort();
/** Sort canonical statements too: statement order has no effect on IAM decisions. */
export function normalizeIamPolicy(policy: IamPolicyDocument): NormalizedIamPolicyDocument {
  const statements = (Array.isArray(policy.Statement) ? policy.Statement : [policy.Statement]).map((statement) => ({
    ...(statement.Sid ? { Sid: statement.Sid.trim() } : {}),
    Effect: statement.Effect,
    Action: patterns(statement.Action),
    Resource: patterns(statement.Resource),
  }));
  const unique = [...new Map(statements.map((statement) => [JSON.stringify(statement), statement])).entries()];
  unique.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { Version: "1", Statement: unique.map(([, statement]) => statement) };
}
