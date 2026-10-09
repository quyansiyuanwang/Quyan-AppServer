import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, IAM_ACTION_CATALOG, actionForPermission, buildAcsResource } from "@quyan/shared";
import type { IamPrincipal } from "@quyan/shared";
import {
  accountEntityBatchResourceResolver,
  accountEntityResourceResolver,
  ramAccountResourceResolver,
  developerProjectResourceResolver,
  iamAuthenticatedUserResourceResolver,
  iamPermissionCheckUserResourceResolver,
  ramEffectivePermissionsUserResourceResolver,
  ramAuthorizationResourceResolver,
  ramResourceGroupResourceResolver,
  ramPolicyBindingResourceResolver,
  ramRoleUserBindingResourceResolver,
  ramRoleGroupBindingResourceResolver,
  ramDefaultPolicyVersionResourceResolver,
} from "../../../src/iam/request/resource-resolvers";
import { getIamPrincipal } from "../../../src/iam/request/principal-context";
import { legacyPermissionsToPolicy } from "../../../src/iam/legacy-policy";
const principal: IamPrincipal = {
  subjectUserId: "child",
  principalUserId: "child",
  accountOwnerId: "owner",
  subjectType: "sub_user",
};
describe("IAM resource trust boundaries", () => {
  it("uses the project path and authenticated account, rejecting client resource patterns", async () => {
    expect(
      await developerProjectResourceResolver({
        principal,
        request: {
          params: { projectId: "project-1" },
          body: { accountId: "foreign" },
          headers: { "x-action": "*" },
        } as never,
      }),
    ).toBe("acs:developer:*:owner:project/project-1");
    for (const projectId of ["*", "", undefined, ["project-1"], "bad/id"])
      expect(
        await developerProjectResourceResolver({ principal, request: { params: { projectId } } as never }),
      ).toBeUndefined();
  });
  it("builds self resources only from authenticated identity and check targets from validated body IDs", async () => {
    const request = {
      body: { userId: "other", accountId: "foreign" },
      params: { userId: "other" },
      headers: { "x-user-id": "other", "x-action": "*" },
    } as never;
    expect(await iamAuthenticatedUserResourceResolver({ principal, request })).toBe("acs:quyan:*:owner:user/child");
    expect(await iamPermissionCheckUserResourceResolver({ principal, request })).toBe("acs:quyan:*:owner:user/other");
    for (const userId of ["*", undefined, [], "bad/id"])
      expect(
        await iamPermissionCheckUserResourceResolver({ principal, request: { body: { userId } } as never }),
      ).toBeUndefined();
  });
  it("resolves the inspected user's ARN from validated query input without trusting an account override", async () => {
    expect(
      await ramEffectivePermissionsUserResourceResolver({
        principal,
        request: { query: { userId: "target", accountOwnerId: "foreign" }, headers: { "x-action": "*" } } as never,
      }),
    ).toBe("acs:quyan:*:owner:user/target");
    for (const userId of ["*", "", undefined, ["target"]])
      expect(
        await ramEffectivePermissionsUserResourceResolver({ principal, request: { query: { userId } } as never }),
      ).toBeUndefined();
  });
  it("resolves both sides of policy and role bindings and fails closed on either invalid target", async () => {
    const context = (body: object, params = {}) => ({ principal, request: { body, params } as never });
    expect(
      await ramPolicyBindingResourceResolver(
        context({ policyId: "policy", targetType: "user", targetId: "target", accountOwnerId: "foreign" }),
      ),
    ).toEqual(["acs:quyan:*:owner:policy/policy", "acs:quyan:*:owner:user/target"]);
    for (const targetType of ["service", "account", undefined])
      expect(
        await ramPolicyBindingResourceResolver(context({ policyId: "policy", targetType, targetId: "target" })),
      ).toBeUndefined();
    expect(
      await ramPolicyBindingResourceResolver(context({ policyId: "*", targetType: "role", targetId: "target" })),
    ).toBeUndefined();
    expect(await ramRoleUserBindingResourceResolver(context({ userId: "user" }, { roleId: "role" }))).toEqual([
      "acs:quyan:*:owner:role/role",
      "acs:quyan:*:owner:user/user",
    ]);
    expect(await ramRoleGroupBindingResourceResolver(context({}, { roleId: "role", groupId: "group" }))).toEqual([
      "acs:quyan:*:owner:role/role",
      "acs:quyan:*:owner:group/group",
    ]);
    expect(await ramRoleUserBindingResourceResolver(context({ userId: "*" }, { roleId: "role" }))).toBeUndefined();
  });
  it("checks both policy and exact version when changing the default", async () => {
    const context = (versionId: unknown) => ({
      principal,
      request: { params: { policyId: "policy" }, body: { versionId } } as never,
    });
    expect(await ramDefaultPolicyVersionResourceResolver(context("version"))).toEqual([
      "acs:quyan:*:owner:policy/policy",
      "acs:quyan:*:owner:policy-version/policy/version",
    ]);
    expect(await ramDefaultPolicyVersionResourceResolver(context("*"))).toBeUndefined();
    expect(await ramDefaultPolicyVersionResourceResolver(context(undefined))).toBeUndefined();
  });

  it("maps every legacy permission once without action collisions", () => {
    const actions = ALL_PERMISSIONS.map(actionForPermission);
    expect(new Set(actions).size).toBe(ALL_PERMISSIONS.length);
    expect(actions.every((action) => IAM_ACTION_CATALOG.includes(action))).toBe(true);
  });
  it("ignores client account/region values when resolving an entity", async () => {
    const context = {
      principal,
      request: { body: { id: "target", accountId: "victim", region: "attacker" } } as never,
    };
    expect(await accountEntityResourceResolver("user", (req) => (req.body as { id: string }).id)(context)).toBe(
      "acs:quyan:*:owner:user/target",
    );
    expect(await ramAccountResourceResolver(context)).toBe("acs:quyan:*:owner:account");
  });
  it("constructs every batch target with trusted ownership and rejects a partially invalid batch", async () => {
    const resolve = accountEntityBatchResourceResolver("user", (req) => (req.body as { ids: unknown }).ids);
    const context = (ids: unknown) => ({ principal, request: { body: { ids, accountId: "victim" } } as never });
    expect(await resolve(context(["one", "two"]))).toEqual([
      "acs:quyan:*:owner:user/one",
      "acs:quyan:*:owner:user/two",
    ]);
    for (const ids of [
      [],
      null,
      "one",
      ["one", "*"],
      ["one", "../two"],
      ["one", null],
      new Array(2),
      new Array(501).fill("one"),
    ])
      expect(await resolve(context(ids))).toBeUndefined();
  });
  it("resolves IAM control-plane targets from validated paths and trusted accounts", async () => {
    const request = {
      params: { authorizationId: "authorization", groupId: "group" },
      body: { accountOwnerId: "foreign" },
    } as never;
    expect(await ramAuthorizationResourceResolver({ principal, request })).toBe(
      "acs:quyan:*:owner:authorization/authorization",
    );
    expect(await ramResourceGroupResourceResolver({ principal, request })).toBe(
      "acs:quyan:*:owner:resource-group/group",
    );
    expect(
      await ramResourceGroupResourceResolver({ principal, request: { params: { groupId: "*" } } as never }),
    ).toBeUndefined();
  });
  it("requires authentication-enriched principal context", () => {
    expect(
      getIamPrincipal({ user: { userId: "child" }, headers: { "x-account-id": "owner" } } as never),
    ).toBeUndefined();
    expect(
      getIamPrincipal({
        user: { userId: "child" },
        authContext: { principalUserId: "child", accountOwnerId: "owner", subjectType: "access_key" },
      } as never)?.subjectType,
    ).toBe("access_key");
    expect(
      getIamPrincipal({
        user: { userId: "child" },
        authContext: {
          principalUserId: "child",
          accountOwnerId: "owner",
          subjectType: "sub_user",
          roleSessionId: "session",
          assumedRoleId: "role",
        },
      } as never)?.subjectType,
    ).toBe("assumed_role");
  });
  it("builds regionless global IAM user ARNs while rejecting malformed region components", () => {
    expect(buildAcsResource({ service: "quyan", region: "", accountId: "owner", path: "user/target" })).toBe(
      "acs:quyan::owner:user/target",
    );
    expect(() =>
      buildAcsResource({ service: "quyan", region: "bad:region", accountId: "owner", path: "user/target" }),
    ).toThrow();
  });
  it("never allows wildcard injection into constructed resources", () => {
    expect(() => buildAcsResource({ service: "quyan", region: "*", accountId: "*", path: "user/a.cn" })).toThrow();
    expect(() => buildAcsResource({ service: "quyan", region: "*", accountId: "owner", path: "user/*" })).toThrow();
  });
  it("converts removes to Deny and rejects unrecognized persisted legacy values", () => {
    const policy = legacyPermissionsToPolicy([ALL_PERMISSIONS[0]], "owner", "Deny")!;
    expect(policy.Statement[0].Effect).toBe("Deny");
    expect(legacyPermissionsToPolicy([], "owner")).toBeUndefined();
    expect(() => legacyPermissionsToPolicy(["fake:permission"], "owner")).toThrow();
  });
});
