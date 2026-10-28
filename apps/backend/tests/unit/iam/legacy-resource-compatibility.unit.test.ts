import { describe, expect, it } from "vitest";
import { Permission } from "@quyan/shared";
import { legacyPermissionsToPolicy } from "@/iam/legacy-policy";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
const action = "quyan:ram:UpdateUser";
const decision = (document: ReturnType<typeof parseIamPolicy>["document"], resource: string) =>
  evaluatePolicies([{ policyId: "fixture", document }], { action, resource }).decision;
describe("legacy resource compatibility", () => {
  it("preserves account-wide legacy permissions on concrete targets without crossing accounts or action types", () => {
    const document = legacyPermissionsToPolicy([Permission.RAM_USER_UPDATE], "owner")!;
    expect(decision(document, "acs:quyan:*:owner:account")).toBe("Allow");
    expect(decision(document, "acs:quyan:*:owner:user/first")).toBe("Allow");
    expect(decision(document, "acs:quyan:*:owner:user/second")).toBe("Allow");
    expect(decision(document, "acs:quyan:*:foreign:user/first")).toBe("ImplicitDeny");
    expect(decision(document, "acs:quyan:*:owner:policy/first")).toBe("ImplicitDeny");
    expect(
      evaluatePolicies([{ policyId: "fixture", document }], {
        action: "quyan:ram:DeleteUser",
        resource: "acs:quyan:*:owner:user/first",
      }).decision,
    ).toBe("ImplicitDeny");
  });
  it("does not widen explicit IAM account grants or narrowly scoped user grants", () => {
    const accountOnly = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: action, Resource: "acs:quyan:*:owner:account" },
    }).document;
    expect(decision(accountOnly, "acs:quyan:*:owner:user/first")).toBe("ImplicitDeny");
    const oneUser = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: action, Resource: "acs:quyan:*:owner:user/first" },
    }).document;
    expect(decision(oneUser, "acs:quyan:*:owner:user/first")).toBe("Allow");
    expect(decision(oneUser, "acs:quyan:*:owner:user/second")).toBe("ImplicitDeny");
  });
  it("retains explicit legacy removals on every concrete resource", () => {
    const allow = legacyPermissionsToPolicy([Permission.RAM_USER_UPDATE], "owner")!;
    const deny = legacyPermissionsToPolicy([Permission.RAM_USER_UPDATE], "owner", "Deny")!;
    expect(
      evaluatePolicies(
        [
          { policyId: "allow", document: allow },
          { policyId: "deny", document: deny },
        ],
        { action, resource: "acs:quyan:*:owner:user/first" },
      ).decision,
    ).toBe("ExplicitDeny");
  });
});
