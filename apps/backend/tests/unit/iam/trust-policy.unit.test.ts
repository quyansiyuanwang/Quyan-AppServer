import { describe, expect, it } from "vitest";
import type { IamPrincipal } from "@quyan/shared";
import { parseIamTrustPolicy, evaluateIamTrustPolicy, IAM_ASSUME_ROLE_ACTION } from "@/iam/trust/trust-policy";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { diagnoseIamPolicy } from "@/iam/diagnostics/policy-diagnostics";
import { getIamPolicyJsonSchema } from "@/iam/diagnostics/policy-json-schema";
const principal: IamPrincipal = {
  subjectUserId: "child",
  principalUserId: "child",
  accountOwnerId: "owner",
  subjectType: "sub_user",
};
const statement = {
  Effect: "Allow" as const,
  Action: IAM_ASSUME_ROLE_ACTION,
  Resource: "acs:quyan:*:owner:role/role",
  Principal: { RAM: "acs:quyan::owner:user/child" },
};
const policy = { Version: "1" as const, Statement: statement };
const request = { principal, roleArn: "acs:quyan:*:owner:role/role" };
describe("typed RAM role trust policies", () => {
  it("requires identity permission evaluation separately and matches exact RAM principals", () => {
    expect(evaluateIamTrustPolicy(policy, request).decision).toBe("Allow");
    expect(
      evaluateIamTrustPolicy(policy, {
        ...request,
        principal: { ...principal, principalUserId: "other", subjectUserId: "other" },
      }).decision,
    ).toBe("ImplicitDeny");
    expect(evaluateIamTrustPolicy(policy, { ...request, roleArn: "acs:quyan:*:other:role/role" }).decision).toBe(
      "ImplicitDeny",
    );
    expect(evaluateIamTrustPolicy(policy, { ...request, roleArn: "acs:quyan:*:owner:account" }).decision).toBe(
      "ImplicitDeny",
    );
    expect(
      evaluateIamTrustPolicy(policy, { ...request, principal: { ...principal, subjectType: "assumed_role" } }).decision,
    ).toBe("ImplicitDeny");
    expect(
      evaluateIamTrustPolicy(policy, { ...request, principal: { ...principal, subjectType: "service" } }).decision,
    ).toBe("ImplicitDeny");
  });
  it("applies trust Deny priority and conditions without ignoring unavailable context", () => {
    const deny = { ...statement, Effect: "Deny" as const, Condition: { IpAddress: { "acs:SourceIp": "10.0.0.0/8" } } };
    const conditional = { Version: "1", Statement: [statement, deny] };
    expect(evaluateIamTrustPolicy(conditional, request).reason).toBe("missing-condition-context");
    expect(evaluateIamTrustPolicy(conditional, { ...request, context: { "acs:SourceIp": "10.1.1.1" } }).decision).toBe(
      "ExplicitDeny",
    );
    expect(evaluateIamTrustPolicy(conditional, { ...request, context: { "acs:SourceIp": "192.0.2.1" } }).decision).toBe(
      "Allow",
    );
  });
  it.each([
    { ...statement, Principal: undefined },
    { ...statement, Principal: "*" },
    { ...statement, Principal: { RAM: "*" } },
    { ...statement, Principal: { Service: "quyan" } },
    { ...statement, Action: "quyan:ram:*" },
    { ...statement, Action: "quyan:ram:ReadUser" },
    { ...statement, Resource: "acs:quyan:*:owner:user/child" },
    { ...statement, NotAction: "quyan:ram:ReadUser" },
  ])("rejects missing or unsupported trust semantics %#", (value) =>
    expect(() => parseIamTrustPolicy({ Version: "1", Statement: value })).toThrow(),
  );
  it("continues rejecting Principal in identity policies and unsafe JSON in trust policies", () => {
    expect(() => parseIamPolicy(policy)).toThrow();
    expect(() => parseIamTrustPolicy('{"Version":"1","Statement":{},"__proto__":{}}')).toThrow();
    expect(() => parseIamTrustPolicy('{"Version":"1","Version":"1","Statement":{}}')).toThrow();
  });
  it("normalizes object/array forms and principal order into a stable hash", () => {
    const a = parseIamTrustPolicy({
      ...policy,
      Statement: { ...statement, Principal: { RAM: ["acs:quyan::owner:user/child", "acs:quyan::owner:user/other"] } },
    });
    const b = parseIamTrustPolicy({
      ...policy,
      Statement: [
        {
          ...statement,
          Action: [statement.Action],
          Resource: [statement.Resource],
          Principal: {
            RAM: ["acs:quyan::owner:user/other", "acs:quyan::owner:user/child", "acs:quyan::owner:user/child"],
          },
        },
      ],
    });
    expect(a.documentHash).toBe(b.documentHash);
    expect(parseIamTrustPolicy(a.document).documentHash).toBe(a.documentHash);
  });
  it("publishes a separate Schema and diagnoses principal errors at original paths", () => {
    expect(getIamPolicyJsonSchema("trust")).toMatchObject({
      "x-quyan-policy-kind": "trust",
      "x-quyan-actions": [expect.objectContaining({ action: IAM_ASSUME_ROLE_ACTION })],
    });
    const bad = diagnoseIamPolicy(
      JSON.stringify(
        { ...policy, Statement: { ...statement, Principal: { RAM: "acs:quyan::other:user/child" } } },
        null,
        2,
      ),
      "owner",
      "trust",
    );
    expect(bad.valid).toBe(false);
    expect(bad.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "cross-account-principal",
        path: "/Statement/Principal/RAM",
        line: expect.any(Number),
        column: expect.any(Number),
      }),
    );
    expect(diagnoseIamPolicy(JSON.stringify(policy), "owner", "trust").valid).toBe(true);
    expect(diagnoseIamPolicy(JSON.stringify(policy), "owner").valid).toBe(false);
  });
});
