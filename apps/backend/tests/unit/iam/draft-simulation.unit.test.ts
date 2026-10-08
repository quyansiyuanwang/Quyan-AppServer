import { describe, expect, it } from "vitest";
import { evaluateIdentityPolicyDraft } from "@/iam/simulation/draft-simulation";
const resource = "acs:quyan:*:owner:user/one";
const statement = { Effect: "Allow", Action: "quyan:ram:ReadUser", Resource: resource };
const document = (Statement: unknown) => JSON.stringify({ Version: "1", Statement });
const evaluate = (text: string, actual = resource) =>
  evaluateIdentityPolicyDraft(text, "owner", {
    action: "quyan:ram:ReadUser",
    resource: actual,
    context: { "quyan:PrincipalId": "child", "quyan:PrincipalAccount": "owner", "quyan:PrincipalType": "sub_user" },
  });
describe("isolated identity draft simulation", () => {
  it("allows the specific resource, denies others and collects synthetic statement identifiers", () => {
    expect(evaluate(document(statement))).toMatchObject({
      decision: "Allow",
      matchedStatements: [{ policyId: "simulation:draft", statementId: "0", effect: "Allow" }],
    });
    expect(evaluate(document(statement), "acs:quyan:*:owner:user/two").decision).toBe("ImplicitDeny");
  });
  it("preserves explicit Deny priority inside the draft", () => {
    expect(evaluate(document([statement, { ...statement, Effect: "Deny" }])).decision).toBe("ExplicitDeny");
  });
  it("does not invent HTTP conditions and fails closed even when another statement Allows", () => {
    expect(
      evaluate(
        document([
          statement,
          { ...statement, Effect: "Deny", Condition: { IpAddress: { "acs:SourceIp": "203.0.113.0/24" } } },
        ]),
      ),
    ).toMatchObject({ decision: "ImplicitDeny", reason: "missing-condition-context" });
  });
  it("evaluates the trusted principal attributes and rejects incompatible resource types", () => {
    const conditional = { ...statement, Condition: { StringEquals: { "quyan:PrincipalId": "child" } } };
    expect(evaluate(document(conditional)).decision).toBe("Allow");
    expect(
      evaluate(document({ ...conditional, Condition: { StringEquals: { "quyan:PrincipalId": "other" } } })).decision,
    ).toBe("ImplicitDeny");
    expect(evaluate(document(statement), "acs:quyan:*:owner:policy/one").reason).toBe("invalid-request");
  });
  it("rejects a foreign resource even for an all-resource Allow", () => {
    expect(evaluate(document({ ...statement, Resource: "*" }), "acs:quyan:*:foreign:user/one")).toMatchObject({
      decision: "ImplicitDeny",
      reason: "invalid-request",
    });
  });
  it.each([
    "{",
    '{"Version":"1","Statement":{"Effect":"Allow","Effect":"Deny","Action":"quyan:ram:ReadUser","Resource":"*"}}',
    document({ ...statement, Action: "alidns:AddDomainRecord" }),
    document({ ...statement, Resource: "acs:quyan:*:foreign:user/one" }),
    document({ ...statement, Principal: { RAM: "acs:quyan::owner:user/child" } }),
  ])("rejects ambiguous, unsupported or foreign draft documents", (text) => {
    expect(() => evaluate(text)).toThrow("Invalid IAM simulation draft");
  });
});
