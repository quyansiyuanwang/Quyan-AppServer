import { describe, expect, it } from "vitest";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import type { IamPolicyInput } from "@/iam/evaluator/policy-evaluator";
const policy = (id: string): IamPolicyInput => ({
  policyId: id,
  versionId: "version-1",
  authorizationId: "authorization-1",
  document: parseIamPolicy({
    Version: "1",
    Statement: [
      { Effect: "Allow", Action: "quyan:system:error_report:GetErrorGroup", Resource: "*" },
      {
        Effect: "Deny",
        Action: "quyan:system:error_report:ListErrorGroups",
        Resource: "acs:platform:*:platform:error-group/private",
      },
    ],
  }).document,
  scope: {
    type: "resource-group",
    id: "group-1",
    resources: ["acs:platform:*:platform:error-group/a", "acs:platform:*:platform:error-group/b"],
  },
});
describe("IAM policy set revision fingerprint", () => {
  it("does not depend on policy, statement or membership order and does not mutate inputs", () => {
    const a = policy("a"),
      b = policy("b"),
      copy = structuredClone(a);
    const reordered = {
      ...a,
      document: { ...a.document, Statement: [...a.document.Statement].reverse() },
      scope: { type: "resource-group" as const, id: "group-1", resources: [...(a.scope as any).resources].reverse() },
    };
    expect(fingerprintIamPolicies([a, b])).toBe(fingerprintIamPolicies([b, reordered]));
    expect(a).toEqual(copy);
  });
  it.each(["policy", "version", "binding", "group", "membership", "document"])("detects %s changes", (kind) => {
    const a = policy("a"),
      changed = structuredClone(a);
    if (kind === "policy") changed.policyId = "other";
    if (kind === "version") changed.versionId = "version-2";
    if (kind === "binding") changed.authorizationId = "other";
    if (kind === "group" && changed.scope?.type === "resource-group") changed.scope.id = "other";
    if (kind === "membership" && changed.scope?.type === "resource-group") changed.scope.resources = [];
    if (kind === "document") changed.document.Statement[0].Effect = "Deny";
    expect(fingerprintIamPolicies([a])).not.toBe(fingerprintIamPolicies([changed]));
  });
  it("rejects malformed persisted documents and has a stable empty fingerprint", () => {
    expect(fingerprintIamPolicies([])).toHaveLength(64);
    const bad = policy("a");
    (bad.document as any).Version = "future";
    expect(() => fingerprintIamPolicies([bad])).toThrow();
  });
});
