import { describe, expect, it } from "vitest";
import { IAM_ACTION_CATALOG, getIamActionDefinition, type IamPolicyDocument } from "@quyan/shared";
import { IAM_POLICY_LIMITS } from "@/iam/parser/policy-schema";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { checkIamDelegation } from "@/iam/delegation/delegation-check";
import { diagnoseIamPolicy } from "@/iam/diagnostics/policy-diagnostics";
import { getIamPolicyJsonSchema } from "@/iam/diagnostics/policy-json-schema";
import { parseIamTrustPolicy, IAM_ASSUME_ROLE_ACTION } from "@/iam/trust/trust-policy";
const resource = "acs:quyan:*:owner:user/target";
const policy = (NotAction: string | string[], Effect: "Allow" | "Deny" = "Allow"): IamPolicyDocument => ({
  Version: "1",
  Statement: { Effect, NotAction, Resource: resource },
});
const evaluate = (input: unknown, action: string) =>
  evaluatePolicies([{ policyId: "snapshot", document: parseIamPolicy(input).document }], { action, resource });
describe("bounded catalog-snapshot NotAction", () => {
  it("expands only registered resource-compatible actions and excludes exact/pattern matches", () => {
    const result = parseIamPolicy(policy(["quyan:ram:DeleteUser", "quyan:permission:*"]));
    const actions = result.document.Statement[0].Action;
    expect(actions).toContain("quyan:ram:ReadUser");
    expect(actions).not.toContain("quyan:ram:DeleteUser");
    expect(actions.some((action) => action.startsWith("quyan:permission:"))).toBe(false);
    expect(
      actions.every(
        (action) =>
          IAM_ACTION_CATALOG.includes(action) && getIamActionDefinition(action)!.resourceTypes.includes("quyan/user"),
      ),
    ).toBe(true);
    expect(actions).not.toContain("quyan:relay:channel:Update");
    expect(actions.some((action) => action.includes("*"))).toBe(false);
    expect(result.canonicalJson).not.toContain("NotAction");
  });
  it("normalizes equivalent exclusion order and reparses the persisted explicit snapshot without expansion", () => {
    const a = parseIamPolicy(policy(["quyan:ram:DeleteUser", "quyan:permission:*", "quyan:ram:DeleteUser"]));
    const b = parseIamPolicy(policy(["quyan:permission:*", "quyan:ram:DeleteUser"]));
    expect(a.documentHash).toBe(b.documentHash);
    expect(parseIamPolicy(a.canonicalJson).documentHash).toBe(a.documentHash);
    const equivalent = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: a.document.Statement[0].Action, Resource: resource },
    });
    expect(equivalent.documentHash).toBe(a.documentHash);
  });
  it("keeps excluded actions implicitly denied and included actions allowed", () => {
    expect(evaluate(policy("quyan:ram:DeleteUser"), "quyan:ram:ReadUser").decision).toBe("Allow");
    expect(evaluate(policy("quyan:ram:DeleteUser"), "quyan:ram:DeleteUser").decision).toBe("ImplicitDeny");
    expect(evaluate(policy("quyan:ram:DeleteUser"), "alidns:AddDomainRecord").decision).toBe("ImplicitDeny");
  });
  it("lets a compiled Deny override Allow without affecting its excluded actions", () => {
    const deny = parseIamPolicy(policy("quyan:ram:ReadUser", "Deny")).document;
    const allow = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:*User", Resource: resource },
    }).document;
    const policies = [
      { policyId: "deny", document: deny },
      { policyId: "allow", document: allow },
    ];
    expect(evaluatePolicies(policies, { action: "quyan:ram:UpdateUser", resource }).decision).toBe("ExplicitDeny");
    expect(evaluatePolicies(policies, { action: "quyan:ram:ReadUser", resource }).decision).toBe("Allow");
  });
  it.each([
    { Effect: "Allow", Action: "quyan:ram:ReadUser", NotAction: "quyan:ram:DeleteUser", Resource: resource },
    { Effect: "Allow", Resource: resource },
    { Effect: "Allow", NotAction: "*", Resource: resource },
    { Effect: "Allow", NotAction: "alidns:*", Resource: resource },
    { Effect: "Allow", NotAction: "quyan:missing:*", Resource: resource },
    { Effect: "Allow", NotAction: [], Resource: resource },
  ])("rejects ambiguous, empty and unknown selectors %#", (Statement) => {
    expect(() => parseIamPolicy({ Version: "1", Statement })).toThrow();
  });
  it("requires proof of every expanded Allow rather than proof of the excluded action", () => {
    const candidate = parseIamPolicy(policy("quyan:ram:DeleteUser")).document;
    const narrow = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: resource },
    }).document;
    expect(checkIamDelegation(candidate, [narrow]).allowed).toBe(false);
    expect(checkIamDelegation(candidate, [candidate]).allowed).toBe(true);
  });
  it("locates the expansion warning on the original selector and keeps trust explicit", () => {
    const diagnosis = diagnoseIamPolicy(JSON.stringify(policy("quyan:ram:DeleteUser"), null, 2), "owner");
    expect(diagnosis.valid).toBe(true);
    expect(diagnosis.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "not-action-snapshot",
        path: "/Statement/NotAction",
        severity: "security-warning",
        line: 5,
      }),
    );
    expect(diagnosis.document?.Statement[0]).toHaveProperty("Action");
    expect(diagnoseIamPolicy(JSON.stringify(policy("quyan:ram:ReadUser", "Deny"))).diagnostics).toContainEqual(
      expect.objectContaining({ code: "not-action-snapshot", severity: "warning" }),
    );
    expect(() =>
      parseIamTrustPolicy({
        Version: "1",
        Statement: {
          Effect: "Allow",
          NotAction: IAM_ASSUME_ROLE_ACTION,
          Resource: "acs:quyan:*:owner:role/role",
          Principal: { RAM: "acs:quyan::owner:user/actor" },
        },
      }),
    ).toThrow();
    expect(JSON.stringify(getIamPolicyJsonSchema())).toContain("NotAction");
    expect(JSON.stringify(getIamPolicyJsonSchema("trust"))).not.toContain('"NotAction"');
  });
  it("rejects and diagnoses a compact complement whose expanded document exceeds the byte limit", () => {
    // Keep the expansion within the per-statement action limit as the catalog grows.
    const excluded = IAM_ACTION_CATALOG.slice(
      0,
      Math.max(1, IAM_ACTION_CATALOG.length - IAM_POLICY_LIMITS.patterns + 1),
    );
    const input = {
      Version: "1",
      Statement: Array.from({ length: 100 }, (_, index) => ({
        Sid: "Snapshot" + index,
        Effect: "Allow",
        NotAction: excluded,
        Resource: "*",
      })),
    };
    expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(IAM_POLICY_LIMITS.bytes);
    expect(() => parseIamPolicy(input)).toThrow();
    expect(diagnoseIamPolicy(JSON.stringify(input)).diagnostics[0].code).toBe("document-limit");
  });
  it("diagnoses both and missing selectors without calling them unsupported fields", () => {
    for (const Statement of [
      { Effect: "Allow", Resource: resource },
      { Effect: "Allow", Action: "quyan:ram:ReadUser", NotAction: "quyan:ram:DeleteUser", Resource: resource },
    ]) {
      const result = diagnoseIamPolicy(JSON.stringify({ Version: "1", Statement }));
      expect(result.valid).toBe(false);
      expect(result.diagnostics[0].code).toBe("invalid-action-selector");
    }
  });
});
