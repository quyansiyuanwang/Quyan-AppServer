import type { GroupStore } from "@/store/users/group.store";
import type { RamAuthorizationStore } from "@/store/users/ram-authorization.store";
import type { RamResourceGroupStore } from "@/store/users/ram-resource-group.store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Permission } from "@quyan/shared";
import type { IamPrincipal } from "@quyan/shared";
import { mockDeep } from "vitest-mock-extended";
import type { UserStore } from "../../../src/store/users/user.store";
import type { RamRoleStore } from "../../../src/store/users/ram-role.store";
import type { RamPolicyStore } from "../../../src/store/users/ram-policy.store";
vi.mock("../../../src/store/users/user.repository", () => ({ UserRepository: { getInstance: vi.fn() } }));
vi.mock("../../../src/store/users/ram-role.repository", () => ({ RamRoleRepository: { getInstance: vi.fn() } }));
vi.mock("../../../src/store/users/ram-policy.repository", () => ({ RamPolicyRepository: { getInstance: vi.fn() } }));
vi.mock("../../../src/store/users/ram-authorization.repository", () => ({
  RamAuthorizationRepository: { getInstance: vi.fn() },
}));
vi.mock("../../../src/store/users/ram-resource-group.repository", () => ({
  RamResourceGroupRepository: { getInstance: vi.fn() },
}));
vi.mock("../../../src/config/env", () => ({ env: { security: { superAdminGroupUsername: "admin" } } }));
vi.mock("../../../src/store/users/group.repository", () => ({ GroupRepository: { getInstance: vi.fn() } }));
import { IamAuthorizationService } from "../../../src/iam/iam-authorization.service";
import { parseIamPolicy } from "../../../src/iam/parser/policy-parser";
const principal: IamPrincipal = {
  subjectUserId: "child",
  principalUserId: "child",
  accountOwnerId: "owner",
  subjectType: "sub_user",
};
const users = mockDeep<UserStore>(),
  roles = mockDeep<RamRoleStore>(),
  policies = mockDeep<RamPolicyStore>();
const authorizations = mockDeep<RamAuthorizationStore>(),
  resourceGroups = mockDeep<RamResourceGroupStore>();
const groups = mockDeep<GroupStore>();
const service = new IamAuthorizationService(users, roles, policies, authorizations, resourceGroups, groups);
const role = { id: "role", name: "reader", accountOwnerId: "owner", status: 1 } as never;
function binding(policyId: string, effect: "Allow" | "Deny", action = "quyan:ram:CreateUser") {
  const parsed = parseIamPolicy({
    Version: "1",
    Statement: { Sid: "rule", Effect: effect, Action: action, Resource: "*" },
  });
  return {
    policyId,
    policyName: policyId,
    accountOwnerId: "owner",
    documentFormat: "iam-v1",
    versionId: "version-" + policyId,
    document: parsed.document,
    documentHash: parsed.documentHash,
    validationState: "valid",
    permissions: [],
  };
}
describe("IAM identity policy loading", () => {
  it("loads group direct and role-derived policies for delegation, retaining scoped relations", async () => {
    groups.findById.mockResolvedValue({
      id: "group",
      accountOwnerId: "owner",
      status: 1,
      permissions: [Permission.RAM_USER_READ],
    } as never);
    roles.listRoleBindingsForUser.mockResolvedValue([{ roleId: "role" } as never]);
    policies.listPoliciesForTarget.mockImplementation(async (type) => [binding(type, "Allow")]);
    const result = await service.loadGroupPolicies("owner", "group");
    expect(result.map((policy) => policy.policyId)).toEqual(
      expect.arrayContaining(["group", "role", "legacy:group:group"]),
    );
    expect(roles.listRoleBindingsForUser).toHaveBeenCalledWith("", "group");
    expect(authorizations.listForPrincipals).toHaveBeenCalledWith("owner", [
      { principalType: "group", principalId: "group" },
    ]);
    expect(authorizations.listForPrincipals).toHaveBeenCalledWith("owner", [
      { principalType: "role", principalId: "role" },
    ]);
  });
  it("refuses foreign and disabled groups before loading their grants", async () => {
    for (const group of [
      { id: "group", accountOwnerId: "foreign", status: 1 },
      { id: "group", accountOwnerId: "owner", status: 0 },
      null,
    ]) {
      groups.findById.mockResolvedValue(group as never);
      await expect(service.loadGroupPolicies("owner", "group")).rejects.toThrow();
    }
    expect(policies.listPoliciesForTarget).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authorizations.listForPrincipals.mockResolvedValue([]);
    users.findByIdWithGroup.mockResolvedValue({
      id: "child",
      status: 1,
      accountOwnerId: "owner",
      permissionAdds: [],
      permissionRemoves: [],
      groupId: "group",
      group: { id: "group", username: "users", status: 1, permissions: [] },
    } as never);
    roles.listRoleBindingsForUser.mockResolvedValue([]);
    roles.findRoleById.mockResolvedValue(role);
    policies.listPoliciesForTarget.mockResolvedValue([]);
    policies.listPoliciesForTargets.mockResolvedValue([]);
  });
  it("grants only self permission inspection without account or administrative visibility", async () => {
    for (const subjectType of ["root", "sub_user", "access_key", "service"] as const) {
      const identity = { ...principal, subjectType };
      expect(
        (
          await service.authorize({
            principal: identity,
            action: "quyan:permission:Manage",
            resource: "acs:quyan:*:owner:user/child",
          })
        ).decision,
      ).toBe("Allow");
      for (const resource of [
        "acs:quyan:*:owner:account",
        "acs:quyan:*:owner:user/other",
        "acs:quyan:*:owner:group/group",
        "*",
      ])
        expect(
          (await service.authorize({ principal: identity, action: "quyan:permission:Manage", resource })).decision,
        ).toBe("ImplicitDeny");
      expect(
        (
          await service.authorize({
            principal: identity,
            action: "quyan:permission:Add",
            resource: "acs:quyan:*:owner:user/child",
          })
        ).decision,
      ).toBe("ImplicitDeny");
    }
  });
  it("lets explicit Deny override the authenticated self baseline", async () => {
    policies.listPoliciesForTarget.mockResolvedValue([binding("deny-self-view", "Deny", "quyan:permission:Manage")]);
    expect(
      (
        await service.authorize({
          principal,
          action: "quyan:permission:Manage",
          resource: "acs:quyan:*:owner:user/child",
        })
      ).decision,
    ).toBe("ExplicitDeny");
  });
  it("merges direct/group/role policies and keeps Deny globally dominant", async () => {
    roles.listRoleBindingsForUser.mockResolvedValue([{ roleId: "role", permissions: [] } as never]);
    policies.listPoliciesForTarget.mockImplementation(async (type) =>
      type === "user" ? [binding("user", "Allow")] : [binding("group", "Deny")],
    );
    policies.listPoliciesForTargets.mockResolvedValue([{ ...binding("role-policy", "Allow"), targetId: "role" }]);
    const result = await service.authorize({
      principal,
      action: "quyan:ram:CreateUser",
      resource: "acs:quyan:*:owner:account",
    });
    expect(result.decision).toBe("ExplicitDeny");
    expect(result.matchedStatements).toHaveLength(3);
  });
  it("turns legacy permission removals into Deny even on explicit entity resources", async () => {
    users.findByIdWithGroup.mockResolvedValue({
      id: "child",
      status: 1,
      accountOwnerId: "owner",
      permissionAdds: [Permission.RAM_USER_CREATE],
      permissionRemoves: [Permission.RAM_USER_CREATE],
      group: null,
    } as never);
    policies.listPoliciesForTarget.mockResolvedValue([binding("allow", "Allow")]);
    expect(
      (await service.authorize({ principal, action: "quyan:ram:CreateUser", resource: "acs:quyan:*:owner:user/child" }))
        .decision,
    ).toBe("ExplicitDeny");
  });
  it("reads policies again on every request, so detach/version changes revoke immediately", async () => {
    policies.listPoliciesForTarget.mockResolvedValueOnce([binding("allow", "Allow")]).mockResolvedValue([]);
    const request = { principal, action: "quyan:ram:CreateUser", resource: "acs:quyan:*:owner:account" };
    expect((await service.authorize(request)).decision).toBe("Allow");
    expect((await service.authorize(request)).decision).toBe("ImplicitDeny");
  });
  it("rejects absent/disabled principals, owner mismatches and corrupted hashes", async () => {
    await expect(
      service.authorize({
        principal: { ...principal, accountOwnerId: "victim" },
        action: "quyan:ram:CreateUser",
        resource: "*",
      }),
    ).rejects.toThrow();
    policies.listPoliciesForTarget.mockResolvedValue([{ ...binding("bad", "Allow"), documentHash: "broken" }]);
    await expect(service.loadPolicies(principal)).rejects.toThrow();
    policies.listPoliciesForTarget.mockResolvedValue([{ ...binding("foreign", "Allow"), accountOwnerId: "victim" }]);
    await expect(service.loadPolicies(principal)).rejects.toThrow();
    users.findByIdWithGroup.mockResolvedValue(null);
    await expect(service.loadPolicies(principal)).rejects.toThrow();
  });
  it("validates assumed-role session subject, role, account, revocation and expiry", async () => {
    const assumed = {
      ...principal,
      subjectType: "assumed_role" as const,
      roleSessionId: "session",
      assumedRoleId: "role",
    };
    const session = {
      status: 1,
      id: "session",
      subjectUserId: "child",
      roleId: "role",
      accountOwnerId: "owner",
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
      role,
    };
    roles.findActiveRoleSession.mockResolvedValue(session as never);
    policies.listPoliciesForTargets.mockResolvedValue([{ ...binding("session-policy", "Allow"), targetId: "role" }]);
    expect(
      (await service.authorize({ principal: assumed, action: "quyan:ram:CreateUser", resource: "*" })).decision,
    ).toBe("Allow");
    for (const patch of [
      { status: 0 },
      { subjectUserId: "other" },
      { accountOwnerId: "victim" },
      { roleId: "other" },
      { expiresAt: new Date(0) },
      { revokedAt: new Date() },
    ]) {
      roles.findActiveRoleSession.mockResolvedValue({ ...session, ...patch } as never);
      await expect(service.loadPolicies(assumed)).rejects.toThrow();
    }
    roles.findActiveRoleSession.mockResolvedValue(null);
    await expect(service.loadPolicies(assumed)).rejects.toThrow();
  });
  it("loads only the assumed role, excluding caller policies, groups and unrelated bound roles", async () => {
    const assumed = {
      ...principal,
      subjectType: "assumed_role" as const,
      roleSessionId: "session",
      assumedRoleId: "role",
    };
    roles.findActiveRoleSession.mockResolvedValue({
      id: "session",
      status: 1,
      subjectUserId: "child",
      roleId: "role",
      accountOwnerId: "owner",
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
      role,
    } as never);
    roles.listRoleBindingsForUser.mockResolvedValue([{ roleId: "unrelated" } as never]);
    policies.listPoliciesForTarget.mockResolvedValue([binding("caller", "Allow", "quyan:ram:DeleteUser")]);
    policies.listPoliciesForTargets.mockResolvedValue([
      { ...binding("assumed", "Allow", "quyan:ram:CreateUser"), targetId: "role" },
    ]);
    users.findByIdWithGroup.mockResolvedValue({
      id: "child",
      status: 1,
      accountOwnerId: "owner",
      permissionAdds: [Permission.RAM_USER_DELETE],
      permissionRemoves: [Permission.RAM_USER_CREATE],
      groupId: "group",
      group: { id: "group", status: 1, permissions: [Permission.RAM_USER_DELETE] },
    } as never);
    const rolePolicies = await service.loadPolicies(assumed);
    expect(rolePolicies.map((policy) => policy.policyId)).toEqual(["system:self-permissions:child", "assumed"]);
    expect(roles.listRoleBindingsForUser).not.toHaveBeenCalled();
    expect(policies.listPoliciesForTarget).not.toHaveBeenCalled();
    expect(policies.listPoliciesForTargets).toHaveBeenCalledWith("role", ["role"]);
    expect(authorizations.listForPrincipals).toHaveBeenCalledWith("owner", [
      { principalType: "role", principalId: "role" },
    ]);
    expect(
      (await service.authorize({ principal: assumed, action: "quyan:ram:DeleteUser", resource: "*" })).decision,
    ).toBe("ImplicitDeny");
    expect(
      (await service.authorize({ principal: assumed, action: "quyan:ram:CreateUser", resource: "*" })).decision,
    ).toBe("Allow");
  });
  it("does not give bootstrap administrators new service actions or override Deny", async () => {
    users.findByIdWithGroup.mockResolvedValue({
      id: "child",
      status: 1,
      accountOwnerId: "owner",
      permissionAdds: [],
      permissionRemoves: [Permission.RAM_USER_CREATE],
      groupId: "admin",
      group: { id: "admin", username: "admin", status: 1, permissions: [] },
    } as never);
    expect((await service.authorize({ principal, action: "quyan:iam:SimulatePolicy", resource: "*" })).decision).toBe(
      "ImplicitDeny",
    );
    expect((await service.authorize({ principal, action: "quyan:ram:CreateUser", resource: "*" })).decision).toBe(
      "ExplicitDeny",
    );
  });
  it("rejects foreign group ownership, malformed legacy data and invalid duplicate bindings", async () => {
    users.findByIdWithGroup.mockResolvedValue({
      id: "child",
      status: 1,
      accountOwnerId: "owner",
      permissionAdds: [],
      permissionRemoves: [],
      group: { id: "group", accountOwnerId: "other", status: 1, permissions: [] },
    } as never);
    await expect(service.loadPolicies(principal)).rejects.toThrow();
    users.findByIdWithGroup.mockResolvedValue({
      id: "child",
      status: 1,
      accountOwnerId: "owner",
      permissionAdds: [],
      permissionRemoves: [],
      group: null,
    } as never);
    policies.listPoliciesForTarget.mockResolvedValue([
      {
        policyId: "legacy",
        policyName: "legacy",
        accountOwnerId: "owner",
        documentFormat: "legacy",
        permissions: [Permission.RAM_USER_CREATE],
        legacyPermissions: null,
      },
    ]);
    await expect(service.loadPolicies(principal)).rejects.toThrow();
    policies.listPoliciesForTarget.mockResolvedValue([{ ...binding("duplicate", "Allow"), documentHash: "bad" }]);
    policies.listPoliciesForTargets.mockResolvedValue([{ ...binding("duplicate", "Allow"), targetId: "role" }]);
    await expect(service.loadPolicies(principal)).rejects.toThrow();
  });
  it("rejects a concrete foreign-account request before loading authorization data", async () => {
    expect(
      await service.authorize({ principal, action: "quyan:ram:ReadUser", resource: "acs:quyan:*:other:user/id" }),
    ).toMatchObject({ decision: "ImplicitDeny", reason: "invalid-request" });
    await expect(
      service.authorizeMany({
        principal,
        action: "quyan:ram:ReadUser",
        resources: ["acs:quyan:*:owner:user/id", "acs:quyan:*:other:user/id"],
      }),
    ).rejects.toThrow();
    expect(users.findByIdWithGroup).not.toHaveBeenCalled();
  });
  it("evaluates every batch resource before callers perform mutations", async () => {
    policies.listPoliciesForTarget.mockResolvedValue([
      {
        ...binding("domain", "Allow", "quyan:ram:CreateUser"),
        ...parseIamPolicy({
          Version: "1",
          Statement: { Effect: "Allow", Action: "quyan:ram:CreateUser", Resource: "acs:quyan:*:*:user/qrmr.cn" },
        }),
        documentFormat: "iam-v1",
      },
    ]);
    const results = await service.authorizeMany({
      principal,
      action: "quyan:ram:CreateUser",
      resources: ["acs:quyan:*:owner:user/qrmr.cn", "acs:quyan:*:owner:user/other.cn"],
    });
    expect(results.map((item) => item.decision)).toEqual(["Allow", "ImplicitDeny"]);
    await expect(service.authorizeMany({ principal, action: "quyan:ram:CreateUser", resources: [] })).rejects.toThrow();
  });
  it("loads policies once for a page and filters both explicit and implicit denial without changing row order", async () => {
    policies.listPoliciesForTarget.mockResolvedValue([
      binding("allow", "Allow", "quyan:ram:CreateUser"),
      {
        ...binding("deny", "Deny", "quyan:ram:CreateUser"),
        ...parseIamPolicy({
          Version: "1",
          Statement: {
            Effect: "Deny",
            Action: "quyan:ram:CreateUser",
            Resource: "acs:quyan:*:*:user/blocked.cn",
          },
        }),
      },
    ]);
    const items = [{ domain: "first.cn" }, { domain: "blocked.cn" }, { domain: "last.cn" }];
    const result = await service.filterAuthorizedPage({
      principal,
      action: "quyan:ram:CreateUser",
      items,
      resource: (row) => "acs:quyan:*:owner:user/" + row.domain,
    });
    expect(result).toEqual([items[0], items[2]]);
    expect(items).toHaveLength(3);
    expect(users.findByIdWithGroup).toHaveBeenCalledOnce();
    policies.listPoliciesForTarget.mockResolvedValue([]);
    expect(
      await service.filterAuthorizedPage({
        principal,
        action: "quyan:ram:CreateUser",
        items,
        resource: (row) => "acs:quyan:*:owner:user/" + row.domain,
      }),
    ).toEqual([]);
  });
  it("rejects invalid page resources and capacity overflow and handles empty database pages", async () => {
    expect(
      await service.filterAuthorizedPage({
        principal,
        action: "quyan:ram:CreateUser",
        items: [],
        resource: () => undefined,
      }),
    ).toEqual([]);
    await expect(
      service.filterAuthorizedPage({
        principal,
        action: "quyan:ram:CreateUser",
        items: [1, 2],
        resource: (row) => (row === 1 ? "acs:quyan:*:owner:user/ok.cn" : undefined),
      }),
    ).rejects.toThrow();
    await expect(
      service.authorizeMany({ principal, action: "quyan:ram:CreateUser", resources: new Array(501).fill("*") }),
    ).rejects.toThrow();
    await expect(
      service.authorizeMany({ principal, action: "quyan:ram:CreateUser", resources: new Array(2) }),
    ).rejects.toThrow();
    expect(users.findByIdWithGroup).not.toHaveBeenCalled();
  });
});
