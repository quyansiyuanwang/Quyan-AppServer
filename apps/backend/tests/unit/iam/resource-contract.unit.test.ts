import { assertIamPolicyAccount } from "@/iam/parser/policy-account";
import { describe, expect, it } from "vitest";
import {
  buildAcsResource,
  getIamResourcePatternTypes,
  getIamResourceType,
  isIamActionResourceCompatible,
  isIamResourceInAccount,
  isValidIamResource,
} from "@quyan/shared";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { accountEntityResourceResolver } from "@/iam/request/resource-resolvers";
const policy = (Action: string, Resource: string) => ({
  Version: "1",
  Statement: { Effect: "Allow", Action, Resource },
});
describe("registered resource contracts", () => {
  it.each([
    ["acs:quyan:*:owner:account", "quyan/account"],
    ["acs:quyan:*:owner:user/id", "quyan/user"],
    ["acs:quyan:*:owner:policy-version/policy/version", "quyan/policy-version"],
    ["acs:relay:*:owner:channel/id", "relay/channel"],
    ["acs:article:*:owner:article/id", "article/article"],
  ])("resolves %s to its registered type", (arn, type) => {
    expect(getIamResourceType(arn)?.id).toBe(type);
    expect(isValidIamResource(arn)).toBe(true);
  });
  it.each([
    "acs:alidns:*:owner:domain/example.test",
    "acs:quyan:*:owner:unknown/id",
    "acs:quyan:*:owner:user",
    "acs:quyan:*:owner:user/",
    "acs:quyan:*:owner:user/a/b",
    "acs:quyan:*:owner:account/id",
    "acs:quyan:*:owner:policy-version/one",
    "acs:quyan:*:owner:user/*",
  ])("rejects unknown, incomplete or wildcard request targets %s", (arn) =>
    expect(isValidIamResource(arn)).toBe(false),
  );
  it("permits registered pattern wildcards without permitting unregistered types", () => {
    expect(getIamResourcePatternTypes("acs:quyan:*:*:user/*").map((type) => type.id)).toEqual(["quyan/user"]);
    expect(getIamResourcePatternTypes("acs:quyan:*:*:policy-version/*").map((type) => type.id)).toEqual([
      "quyan/policy-version",
    ]);
    expect(getIamResourcePatternTypes("acs:quyan:*:*:*").length).toBeGreaterThan(1);
    for (const pattern of ["acs:alidns:*:*:domain/*", "acs:quyan:*:*:account/*", "acs:quyan:*:*:user/a/b"])
      expect(getIamResourcePatternTypes(pattern)).toEqual([]);
  });
  it("does not authorize an incompatible target even under wildcard Allow", () => {
    const allow = { policyId: "test", document: parseIamPolicy(policy("*", "*")).document };
    const request = { action: "quyan:ram:UpdateUser", resource: "acs:quyan:*:owner:role/id" };
    expect(isIamActionResourceCompatible(request.action, request.resource)).toBe(false);
    expect(evaluatePolicies([allow], request)).toMatchObject({ decision: "ImplicitDeny", reason: "invalid-request" });
    expect(() => parseIamPolicy(policy(request.action, request.resource))).toThrow();
    expect(() => parseIamPolicy(policy("*", "acs:alidns:*:owner:domain/*"))).toThrow();
  });
  it("accepts broad Action only for the compatible subset of a registered resource type", () => {
    const document = parseIamPolicy(policy("quyan:ram:*", "acs:quyan:*:owner:user/*")).document;
    expect(
      evaluatePolicies([{ policyId: "test", document }], {
        action: "quyan:ram:UpdateUser",
        resource: "acs:quyan:*:owner:user/id",
      }).decision,
    ).toBe("Allow");
    expect(
      evaluatePolicies([{ policyId: "test", document }], {
        action: "quyan:ram:UpdatePolicy",
        resource: "acs:quyan:*:owner:user/id",
      }).decision,
    ).toBe("ImplicitDeny");
  });
  it("prevents concrete cross-account requests before evaluating broad policies", () => {
    expect(isIamResourceInAccount("acs:quyan:*:owner:user/id", "owner")).toBe(true);
    expect(isIamResourceInAccount("acs:quyan:*:other:user/id", "owner")).toBe(false);
  });
  it("rejects foreign resource accounts when publishing or loading identity policies", () => {
    expect(() =>
      assertIamPolicyAccount(
        parseIamPolicy(policy("quyan:ram:ReadUser", "acs:quyan:*:other:user/id")).document,
        "owner",
      ),
    ).toThrow();
    expect(() =>
      assertIamPolicyAccount(parseIamPolicy(policy("quyan:ram:ReadUser", "acs:quyan:*:*:user/id")).document, "owner"),
    ).not.toThrow();
  });
  it("constructs Relay channels in their actual service namespace", async () => {
    expect(
      await accountEntityResourceResolver(
        "relay-channel",
        (request) => request.params.id,
      )({
        principal: {
          subjectUserId: "child",
          principalUserId: "child",
          accountOwnerId: "owner",
          subjectType: "sub_user",
        },
        request: { params: { id: "channel" } } as never,
      }),
    ).toBe("acs:relay:*:owner:channel/channel");
    expect(() => buildAcsResource({ service: "quyan", region: "*", accountId: "owner", path: "unknown/id" })).toThrow();
  });
});
