import { describe, expect, it } from "vitest";
import type { IamPolicyDocument } from "@quyan/shared";
import { parseIamPolicy } from "../../../src/iam/parser/policy-parser";
import { evaluatePolicies } from "../../../src/iam/evaluator/policy-evaluator";
const input = (policyId: string, document: IamPolicyDocument) => ({
  policyId,
  document: parseIamPolicy(document).document,
});
const sample = input("domain-policy", {
  Version: "1",
  Statement: [
    {
      Effect: "Allow",
      Action: [
        "alidns:AddDomainRecord",
        "alidns:UpdateDomainRecord",
        "alidns:DeleteDomainRecord",
        "alidns:SetDomainRecordStatus",
        "alidns:DescribeDomainRecords",
        "alidns:DescribeDomainRecordInfo",
        "alidns:DescribeSubDomainRecords",
      ],
      Resource: ["acs:alidns:*:*:domain/qrmr.cn", "acs:alidns:*:*:domain/api.taoliya.qysyw.cn"],
    },
    { Effect: "Allow", Action: ["alidns:DescribeDomains", "alidns:DescribeDomainInfo"], Resource: "*" },
  ],
});
const domain = "acs:alidns:*:owner:domain/qrmr.cn";
describe("IAM policy decisions", () => {
  it("accepts the supplied domain example without allowing other domains", () => {
    expect(evaluatePolicies([sample], { action: "alidns:AddDomainRecord", resource: domain }).decision).toBe("Allow");
    expect(
      evaluatePolicies([sample], { action: "alidns:AddDomainRecord", resource: "acs:alidns:*:owner:domain/other.cn" })
        .decision,
    ).toBe("ImplicitDeny");
    expect(evaluatePolicies([sample], { action: "alidns:DescribeDomains", resource: "*" }).decision).toBe("Allow");
  });
  it("requires both action and resource to match", () => {
    expect(evaluatePolicies([sample], { action: "alidns:Unknown", resource: domain }).decision).toBe("ImplicitDeny");
    expect(evaluatePolicies([], { action: "alidns:AddDomainRecord", resource: domain }).decision).toBe("ImplicitDeny");
  });
  it("explicit Deny wins irrespective of policy order, while preserving all matching audit references", () => {
    const deny = input("deny", {
      Version: "1",
      Statement: { Sid: "NoWrites", Effect: "Deny", Action: "alidns:*", Resource: "acs:alidns:*:*:domain/*" },
    });
    for (const policies of [
      [sample, deny],
      [deny, sample],
    ]) {
      const result = evaluatePolicies(policies, { action: "alidns:AddDomainRecord", resource: domain });
      expect(result.decision).toBe("ExplicitDeny");
      expect(result.matchedStatements).toHaveLength(2);
      expect(result.matchedStatements).toContainEqual({ policyId: "deny", statementId: "NoWrites", effect: "Deny" });
    }
  });
  it("fails closed on malformed persisted policies and invalid requests", () => {
    expect(evaluatePolicies([sample], { action: "alidns:*", resource: domain }).decision).toBe("ImplicitDeny");
    expect(
      evaluatePolicies([sample], { action: "alidns:AddDomainRecord", resource: "acs:alidns:*:*:domain/*" }).decision,
    ).toBe("ImplicitDeny");
    expect(() =>
      evaluatePolicies(
        [
          {
            policyId: "corrupt",
            document: { Version: "1", Statement: [{ Effect: "Bad", Action: ["*"], Resource: ["*"] }] },
          } as never,
        ],
        { action: "alidns:AddDomainRecord", resource: domain },
      ),
    ).toThrow();
  });
});
