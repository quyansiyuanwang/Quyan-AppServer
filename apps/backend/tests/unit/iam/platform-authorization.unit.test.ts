import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import type { UserStore } from "@/store/users/user.store";
import type { RamRoleStore } from "@/store/users/ram-role.store";
import type { RamPolicyStore } from "@/store/users/ram-policy.store";
import type { RamAuthorizationStore } from "@/store/users/ram-authorization.store";
import type { RamResourceGroupStore } from "@/store/users/ram-resource-group.store";
import type { GroupStore } from "@/store/users/group.store";
import { parseIamPolicy } from "@/iam/parser/policy-parser";
import { assertIamPolicyAccount } from "@/iam/parser/policy-account";
import { legacyPermissionsToPrincipalPolicy } from "@/iam/legacy-policy";
import { getIamResourceType, isIamResourceInAccount, getIamActionDefinition, Permission } from "@quyan/shared";
import { diagnoseIamPolicy } from "@/iam/diagnostics/policy-diagnostics";
import { getIamPolicyJsonSchema } from "@/iam/diagnostics/policy-json-schema";
import { platformOAuthClientArn } from "@/iam/resources/platform-oauth-resources";
const principal = {
    subjectUserId: "actor",
    principalUserId: "actor",
    accountOwnerId: "actor",
    subjectType: "root" as const,
  },
  action = "quyan:oauth:ListSystemClients",
  resource = platformOAuthClientArn("client");
let users: ReturnType<typeof mockDeep<UserStore>>, service: IamAuthorizationService, actor: any;
beforeEach(() => {
  users = mockDeep<UserStore>();
  const roles = mockDeep<RamRoleStore>(),
    policies = mockDeep<RamPolicyStore>(),
    auth = mockDeep<RamAuthorizationStore>(),
    groups = mockDeep<GroupStore>();
  roles.listRoleBindingsForUser.mockResolvedValue([]);
  policies.listPoliciesForTarget.mockResolvedValue([]);
  policies.listPoliciesForTargets.mockResolvedValue([]);
  auth.listForPrincipals.mockResolvedValue([]);
  actor = {
    id: "actor",
    accountOwnerId: null,
    status: 1,
    userType: "root",
    permissionAdds: [],
    permissionRemoves: [],
    groupId: "global",
    group: { id: "global", status: 1, accountOwnerId: null, permissions: [Permission.OAUTH_CLIENT_SYSTEM_MANAGE] },
  };
  users.findByIdWithGroup.mockImplementation(async () => actor);
  service = new IamAuthorizationService(users, roles, policies, auth, mockDeep<RamResourceGroupStore>(), groups, {
    contexts: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => ({}))),
  } as any);
});
describe("deployment-wide IAM authorization boundary", () => {
  it("uses a reserved namespace and cannot pretend a global resource is owned by the caller", () => {
    expect(resource).toBe("acs:platform:*:platform:oauth-client/client");
    expect(getIamResourceType(resource)).toMatchObject({ accountScope: "platform" });
    expect(getIamResourceType("acs:platform:*:actor:oauth-client/client")).toBeUndefined();
    expect(isIamResourceInAccount(resource, "actor")).toBe(false);
    expect(getIamActionDefinition(action)).toMatchObject({
      authorizationBoundary: "platform",
      resourceTypes: ["platform/oauth-client"],
    });
  });
  it("permits a registered global-group operation and preserves explicit Deny", async () => {
    expect((await service.authorize({ principal, action, resource })).decision).toBe("Allow");
    actor.permissionRemoves = [Permission.OAUTH_CLIENT_SYSTEM_MANAGE];
    expect((await service.authorize({ principal, action, resource })).decision).toBe("ExplicitDeny");
  });
  it("account owners and similarly named account groups cannot manufacture global authority", async () => {
    const policy = {
      policyId: "user-created",
      document: parseIamPolicy({ Version: "1", Statement: { Effect: "Allow", Action: "*", Resource: "*" } }).document,
    };
    for (const group of [
      null,
      { ...actor.group, accountOwnerId: "actor", username: "admin" },
      { ...actor.group, status: 0 },
      { ...actor.group, permissions: [] },
    ]) {
      actor = { ...actor, group, permissionAdds: [Permission.OAUTH_CLIENT_SYSTEM_MANAGE] };
      await expect(
        service.evaluateLoadedPolicies({ principal, action, resources: [resource], policies: [policy] }),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
  });
  it("rechecks membership for simulation and rejects identity aliases and missing ceilings", async () => {
    const policies = await service.loadPolicies(principal);
    actor.groupId = "different";
    await expect(
      service.evaluateLoadedPolicies({ principal, action, resources: [resource], policies }),
    ).rejects.toMatchObject({ statusCode: 403 });
    actor.groupId = "global";
    actor.status = 0;
    await expect(
      service.evaluateLoadedPolicies({ principal, action, resources: [resource], policies }),
    ).rejects.toMatchObject({ statusCode: 403 });
    actor.status = 1;
    await expect(
      service.authorizeMany({ principal: { ...principal, subjectUserId: "ACTOR" }, action, resources: [resource] }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not broaden ordinary account checks or accept all-resource requests for platform actions", async () => {
    for (const input of [
      { action, resource: "*" },
      { action, resource: "acs:quyan:*:actor:account" },
      { action: "quyan:oauth:GetClient", resource },
      { action: "quyan:ram:GetUser", resource: "acs:quyan:*:foreign:user/other" },
    ])
      expect((await service.authorize({ principal, ...input })).decision).toBe("ImplicitDeny");
  });
  it("allows explicit platform policy documents while still rejecting foreign account resources", () => {
    const document = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: action, Resource: resource },
    }).document;
    expect(() => assertIamPolicyAccount(document, "actor")).not.toThrow();
    const foreign = parseIamPolicy({
      Version: "1",
      Statement: { Effect: "Allow", Action: "quyan:oauth:GetClient", Resource: "acs:oauth:*:foreign:client/peer/id" },
    }).document;
    expect(() => assertIamPolicyAccount(foreign, "actor")).toThrow();
    const projected = legacyPermissionsToPrincipalPolicy([Permission.OAUTH_CLIENT_SYSTEM_MANAGE], "actor", "actor");
    expect(projected?.Statement.some((s) => s.Resource.includes("acs:platform:*:platform:oauth-client/*"))).toBe(true);
  });
  it("shares platform account validation with JSON diagnostics and exports the platform boundary for AI", () => {
    const input = { Version: "1", Statement: { Effect: "Allow", Action: action, Resource: resource } };
    const diagnosis = diagnoseIamPolicy(JSON.stringify(input), "actor");
    expect(diagnosis.diagnostics.some((d) => d.code === "cross-account-resource")).toBe(false);
    expect(getIamPolicyJsonSchema()["x-quyan-platform-authorization"]).toMatchObject({
      namespace: "platform",
      requiresPersistedGlobalManagementGroup: true,
    });
  });
  it("cannot simulate a platform grant for a disabled account or a fabricated role session", async () => {
    const policies = await service.loadPolicies(principal);
    const sub = { ...principal, accountOwnerId: "owner", subjectType: "sub_user" as const };
    actor.accountOwnerId = "owner";
    users.findActiveById.mockResolvedValue({ id: "owner", status: 0, accountOwnerId: null } as any);
    await expect(
      service.evaluateLoadedPolicies({ principal: sub, policies, action, resources: [resource] }),
    ).rejects.toMatchObject({ statusCode: 403 });
    users.findActiveById.mockResolvedValue({ id: "owner", status: 1, accountOwnerId: null } as any);
    await expect(
      service.evaluateLoadedPolicies({
        principal: { ...sub, subjectType: "assumed_role", assumedRoleId: "role", roleSessionId: "revoked" },
        policies,
        action,
        resources: [resource],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("live delegation qualification", () => {
  const candidate = parseIamPolicy({
    Version: "1",
    Statement: { Effect: "Allow", Action: action, Resource: resource },
  }).document;
  it("retains platform grants only for the real persisted global group", async () => {
    const { checkIamDelegation } = await import("@/iam/delegation/delegation-check");
    expect(checkIamDelegation(candidate, await service.loadDelegatablePolicies(principal)).allowed).toBe(true);
    actor.group.accountOwnerId = "actor";
    actor.permissionAdds = [Permission.OAUTH_CLIENT_SYSTEM_MANAGE];
    expect(checkIamDelegation(candidate, await service.loadDelegatablePolicies(principal)).allowed).toBe(false);
  });
  it("cannot substitute personal permission additions or mismatched group identities for the ceiling", async () => {
    const { checkIamDelegation } = await import("@/iam/delegation/delegation-check");
    actor.permissionAdds = [Permission.OAUTH_CLIENT_SYSTEM_MANAGE];
    for (const group of [
      { ...actor.group, permissions: [] },
      { ...actor.group, status: 0 },
    ]) {
      actor.group = group;
      expect(checkIamDelegation(candidate, await service.loadDelegatablePolicies(principal)).allowed).toBe(false);
    }
    actor.group = { ...actor.group, status: 1, permissions: [Permission.OAUTH_CLIENT_SYSTEM_MANAGE] };
    actor.groupId = "different";
    expect(checkIamDelegation(candidate, await service.loadDelegatablePolicies(principal)).allowed).toBe(false);
  });
  it("preserves explicit denies even when platform qualification is valid", async () => {
    const { checkIamDelegation } = await import("@/iam/delegation/delegation-check");
    actor.permissionRemoves = [Permission.OAUTH_CLIENT_SYSTEM_MANAGE];
    expect(checkIamDelegation(candidate, await service.loadDelegatablePolicies(principal)).allowed).toBe(false);
  });
  it("propagates failed live identity or session reads", async () => {
    actor.status = 0;
    await expect(service.loadDelegatablePolicies(principal)).rejects.toMatchObject({ statusCode: 403 });
    actor.status = 1;
    await expect(
      service.loadDelegatablePolicies({
        ...principal,
        subjectType: "assumed_role",
        assumedRoleId: "role",
        roleSessionId: "expired",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    users.findByIdWithGroup.mockRejectedValue(new Error("unavailable"));
    await expect(service.loadDelegatablePolicies(principal)).rejects.toThrow("unavailable");
  });
});
