import { describe, expect, it } from "vitest";
import { IAM_ACTION_DEFINITIONS, matchIamPattern } from "@quyan/shared";
import type { IamCondition } from "@quyan/shared";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { projectRuntimePoliciesForDelegation } from "@/iam/delegation/runtime-policy";
import { checkIamDelegation } from "@/iam/delegation/delegation-check";

const action = "quyan:ram:UpdateUser";
const platformAction = "quyan:user:GetUser";
const arn = "acs:quyan:*:owner:user/id";
const platformArn = "acs:platform:*:platform:user/id";
function input(Action = action, Resource = "*", Effect = "Allow", Condition?: IamCondition) {
  return {
    policyId: "test",
    document: parseIamPolicy({
      Version: "1",
      Statement: { Effect, Action, Resource, ...(Condition ? { Condition } : {}) },
    }).document,
  };
}
function projected(
  entries: Parameters<typeof projectRuntimePoliciesForDelegation>[0] = [input()],
  qualified: string[] = [],
) {
  return projectRuntimePoliciesForDelegation(entries, "owner", new Set(qualified));
}
function canDelegate(Action: string, Resource: string, grants = projected()) {
  return checkIamDelegation(input(Action, Resource).document, grants).allowed;
}
describe("delegation respects runtime boundaries", () => {
  it("limits wildcard resources to the actor account and registered action types", () => {
    expect(canDelegate(action, arn)).toBe(true);
    expect(canDelegate(action, "acs:quyan:*:foreign:user/id")).toBe(false);
    expect(canDelegate(action, "acs:quyan:*:*:user/*")).toBe(false);
    expect(canDelegate(action, "*")).toBe(false);
    expect(projected()[0].Statement.flatMap((s) => s.Resource)).toEqual([
      "acs:quyan:*:owner:account",
      "acs:quyan:*:owner:group/*",
      "acs:quyan:*:owner:user/*",
    ]);
  });
  it("projects broad service/account patterns to the real boundary", () => {
    expect(canDelegate(action, arn, projected([input(action, "acs:*:*:*:user/*")]))).toBe(true);
    expect(canDelegate(action, arn, projected([input(action, "acs:quyan:*:foreign:user/*")]))).toBe(false);
  });
  it("preserves literal resources and declines unknown wildcard intersections", () => {
    expect(canDelegate(action, arn, projected([input(action, arn)]))).toBe(true);
    expect(canDelegate(action, "acs:quyan:*:owner:user/other", projected([input(action, arn)]))).toBe(false);
    expect(projected([input(action, "acs:quyan:*:own*:user/i*")])).toEqual([]);
  });
  it("requires the independent global-group ceiling for platform actions", () => {
    expect(projected([input(platformAction)])).toEqual([]);
    expect(canDelegate(platformAction, platformArn, projected([input(platformAction)], [platformAction]))).toBe(true);
    expect(canDelegate(platformAction, platformArn, projected([input("*")]))).toBe(false);
    expect(canDelegate("quyan:user:DeleteUser", platformArn, projected([input("*")], [platformAction]))).toBe(false);
  });
  it("does not let platform qualification widen ordinary account grants", () => {
    const grants = projected([input("*")], [platformAction]);
    expect(canDelegate(action, arn, grants)).toBe(true);
    expect(canDelegate(action, "acs:quyan:*:foreign:user/id", grants)).toBe(false);
    expect(canDelegate(platformAction, platformArn, grants)).toBe(true);
  });
  it("intersects authorization scope before account boundaries", () => {
    const grants = projected([{ ...input(), scope: { type: "resource", arn } }]);
    expect(canDelegate(action, arn, grants)).toBe(true);
    expect(canDelegate(action, "acs:quyan:*:owner:user/other", grants)).toBe(false);
    const finite = projectRuntimePoliciesForDelegation(
      [{ ...input(), scope: { type: "resource-group", id: "group", resources: [arn] } }],
      "owner",
      new Set(),
    );
    expect(canDelegate(action, arn, finite)).toBe(true);
    expect(canDelegate(action, "acs:quyan:*:owner:user/*", finite)).toBe(false);
    expect(
      projectRuntimePoliciesForDelegation(
        [{ ...input(), scope: { type: "resource-group", id: "empty", resources: [] } }],
        "owner",
        new Set(),
      ),
    ).toEqual([]);
  });
  it("retains conditional and unqualified platform denies", () => {
    const condition = { Bool: { "acs:SecureTransport": false } };
    const grants = projected([input("*"), input(action, "*", "Deny", condition), input(platformAction, "*", "Deny")]);
    expect(canDelegate(action, arn, grants)).toBe(false);
    expect(grants.flatMap((p) => p.Statement).filter((s) => s.Effect === "Deny")).toHaveLength(2);
    expect(grants.flatMap((p) => p.Statement).find((s) => s.Effect === "Deny")?.Condition).toEqual(
      input(action, "*", "Deny", condition).document.Statement[0].Condition,
    );
  });
  it("does not remove or relax Allow conditions", () => {
    const condition = { Bool: { "acs:SecureTransport": true } };
    const grants = projected([input(action, "*", "Allow", condition)]);
    expect(canDelegate(action, arn, grants)).toBe(false);
    expect(checkIamDelegation(input(action, arn, "Allow", condition).document, grants).allowed).toBe(true);
  });
  it("splits expanded documents at the parser limit without truncating denies", () => {
    const grants = projected([
      ...Array.from({ length: 103 }, (_, index) => {
        const entry = input(action, "*", "Deny");
        entry.document.Statement[0].Sid = "Deny" + index;
        return entry;
      }),
      input(),
    ]);
    expect(grants.length).toBeGreaterThan(1);
    expect(grants.every((p) => p.Statement.length <= 100)).toBe(true);
    expect(grants.flatMap((p) => p.Statement).filter((s) => s.Effect === "Deny")).toHaveLength(103);
    expect(canDelegate(action, arn, grants)).toBe(false);
    for (const document of grants) expect(() => parseIamPolicy(document)).not.toThrow();
  });
  it("only emits registered exact actions from wildcard grants", () => {
    const grants = projected([input("*")]);
    const actions = grants.flatMap((p) => p.Statement).flatMap((s) => s.Action);
    expect(actions.length).toBeGreaterThan(100);
    expect(
      actions.every((action) =>
        IAM_ACTION_DEFINITIONS.some((d) => d.action === action && d.authorizationBoundary !== "platform"),
      ),
    ).toBe(true);
    expect(
      grants
        .flatMap((p) => p.Statement)
        .flatMap((s) => s.Resource)
        .every((r) => !matchIamPattern(r, "acs:quyan:*:foreign:user/id")),
    ).toBe(true);
  });
  it("rejects invalid principals and malformed policy input instead of returning grants", () => {
    expect(() => projectRuntimePoliciesForDelegation([input()], "owner:*", new Set())).toThrow();
    expect(() => projected([{ policyId: "bad", document: { Version: "2", Statement: [] } as never }])).toThrow();
  });
});
