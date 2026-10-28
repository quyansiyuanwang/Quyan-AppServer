import { describe, expect, it } from "vitest";
import { Permission, type IamCondition, type IamConditionContext } from "@quyan/shared";
import { projectIamUiPermissions } from "@/iam/evaluator/ui-permission-projection";
import { evaluatePolicies, type IamPolicyInput } from "@/iam/evaluator/policy-evaluator";
import { parseIamPolicy } from "@/iam/parser/policy-parser";

const target = "acs:quyan:*:owner:user/child";
const peer = "acs:quyan:*:owner:user/peer";
const action = "quyan:ram:ReadUser";
const context = { "quyan:PrincipalId": "actor", "quyan:PrincipalType": "sub_user" };
const policy = (
  Resource = target,
  Effect = "Allow",
  Condition?: IamCondition,
  scope?: IamPolicyInput["scope"],
): IamPolicyInput => ({
  policyId: Effect,
  document: parseIamPolicy({
    Version: "1",
    Statement: { Effect, Action: action, Resource, ...(Condition ? { Condition } : {}) },
  }).document,
  scope,
});
const visible = (policies: IamPolicyInput[], attributes: IamConditionContext = context) =>
  projectIamUiPermissions(policies, attributes).includes(Permission.RAM_USER_READ);

describe("presentation-only IAM permission projection", () => {
  it("admits scoped workflows without manufacturing account or peer execution privileges", () => {
    const policies = [policy()];
    expect(visible(policies)).toBe(true);
    expect(projectIamUiPermissions(policies, context)).not.toContain(Permission.RAM_USER_DELETE);
    expect(evaluatePolicies(policies, { action, resource: target, context }).decision).toBe("Allow");
    for (const resource of [peer, "acs:quyan:*:owner:account"])
      expect(evaluatePolicies(policies, { action, resource, context }).decision).toBe("ImplicitDeny");
  });
  it("retains resource and finite resource-group authorization scopes", () => {
    expect(visible([policy("*", "Allow", undefined, { type: "resource", arn: target })])).toBe(true);
    expect(visible([policy("*", "Allow", undefined, { type: "resource-group", id: "g", resources: [target] })])).toBe(
      true,
    );
    expect(visible([policy("*", "Allow", undefined, { type: "resource-group", id: "g", resources: [] })])).toBe(false);
    expect(visible([policy(peer, "Allow", undefined, { type: "resource-group", id: "g", resources: [target] })])).toBe(
      false,
    );
    expect(visible([policy(peer, "Allow", undefined, { type: "resource", arn: target })])).toBe(false);
    expect(visible([policy("*", "Allow", undefined, { type: "resource", arn: "acs:quyan:*:owner:role/*" })])).toBe(
      false,
    );
    expect(
      visible([
        policy("acs:quyan:*:owner:user/*", "Allow", undefined, { type: "resource", arn: "acs:quyan:*:owner:role/*" }),
      ]),
    ).toBe(false);
  });
  it("hides proven covering Denies, but not a partial Deny against another resource", () => {
    expect(visible([policy(), policy("*", "Deny")])).toBe(false);
    expect(visible([policy(), policy(target, "Deny")])).toBe(false);
    expect(visible([policy(), policy(peer, "Deny")])).toBe(true);
    expect(visible([policy("acs:quyan:*:owner:user/*"), policy(target, "Deny")])).toBe(true);
    expect(visible([policy(), policy("*", "Deny", undefined, { type: "resource", arn: peer })])).toBe(true);
    expect(
      visible([policy(), policy("*", "Deny", undefined, { type: "resource-group", id: "g", resources: [target] })]),
    ).toBe(false);
    expect(
      visible([policy(), policy("*", "Deny", undefined, { type: "resource-group", id: "g", resources: [] })]),
    ).toBe(true);
  });
  it("evaluates trusted principal and available transport attributes", () => {
    const condition = { StringEquals: { "quyan:PrincipalId": "someone-else" } };
    expect(visible([policy(target, "Allow", condition)])).toBe(false);
    expect(visible([policy(), policy("*", "Deny", condition)])).toBe(true);
    const https = { Bool: { "acs:SecureTransport": true } };
    expect(visible([policy(target, "Allow", https)], { ...context, "acs:SecureTransport": true })).toBe(true);
    expect(visible([policy(target, "Allow", https)], { ...context, "acs:SecureTransport": false })).toBe(false);
    expect(visible([policy(), policy("*", "Deny", https)], { ...context, "acs:SecureTransport": true })).toBe(false);
  });
  it("defers unavailable attributes to live authorization without claiming an Allow", () => {
    const condition = { Bool: { "acs:SecureTransport": true } };
    const policies = [policy(target, "Allow", condition)];
    expect(visible(policies)).toBe(true);
    expect(evaluatePolicies(policies, { action, resource: target, context })).toMatchObject({
      decision: "ImplicitDeny",
      reason: "missing-condition-context",
    });
    expect(visible([policy(), policy("*", "Deny", condition)])).toBe(true);
  });
  it("does not hide resource-conditioned workflows before a resource has been selected", () => {
    const condition = { StringEquals: { "quyan:ResourceGroupId": "team" } };
    expect(visible([policy(target, "Allow", condition)])).toBe(true);
    // A known-false principal clause still eliminates a statement with unknown resource context.
    expect(
      visible([
        policy(target, "Allow", { ...condition, StringNotEquals: { "quyan:PrincipalId": ["actor", "blocked"] } }),
      ]),
    ).toBe(false);
  });
  it("does not conceal unknown wildcard intersections", () => {
    expect(
      visible([
        policy("acs:quyan:*:owner:user/id-*", "Allow", undefined, {
          type: "resource",
          arn: "acs:quyan:*:owner:user/*-1",
        }),
      ]),
    ).toBe(true);
  });
  it("requires an Allow and validates all persisted documents before projection", () => {
    expect(visible([])).toBe(false);
    expect(visible([policy("*", "Deny")])).toBe(false);
    expect(() => visible([policy(), { ...policy(), document: { Version: "1", Statement: [] } }])).toThrow();
  });
});
