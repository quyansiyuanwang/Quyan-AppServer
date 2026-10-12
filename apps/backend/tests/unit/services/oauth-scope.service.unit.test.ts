import { Permission, getOAuthScopeCatalog, getOAuthScopeDefinition, getOAuthScopeAliases } from "@quyan/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionService } from "../../../src/services/users/permission.service";
import { oauthScopeService } from "../../../src/services/oauth/oauth-scope.service";

describe("OAuth scope catalog", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("contains every shared permission exactly once", () => {
    const catalog = getOAuthScopeCatalog();
    const scopes = new Set(catalog.map((item) => item.scope));

    expect(scopes.size).toBe(catalog.length);
    expect(Object.values(Permission).every((scope) => scopes.has(scope))).toBe(true);
  });

  it("marks mutating permission scopes as high risk", () => {
    expect(getOAuthScopeDefinition(Permission.RELAY_TOKEN_CREATE)?.riskLevel).toBe("high");
    expect(getOAuthScopeDefinition(Permission.RELAY_TOKEN_READ)?.riskLevel).toBe("normal");
  });

  it("filters grantable catalog entries by effective permissions", async () => {
    vi.spyOn(permissionService, "getUserFullPermissions").mockResolvedValue({
      userId: "user-1",
      accountOwnerId: "user-1",
      groupPermissions: [],
      additionalPermissions: [Permission.RELAY_TOKEN_READ],
      removedPermissions: [],
      effectivePermissions: [Permission.RELAY_TOKEN_READ],
    });

    const catalog = await oauthScopeService.listForUser("user-1");
    expect(catalog.find((item) => item.scope === "profile")?.grantable).toBe(true);
    expect(catalog.find((item) => item.scope === Permission.RELAY_TOKEN_READ)?.grantable).toBe(true);
    expect(catalog.find((item) => item.scope === Permission.RELAY_TOKEN_CREATE)?.grantable).toBe(false);
  });

  it("keeps legacy relay usage scopes readable during migration", async () => {
    vi.spyOn(permissionService, "getUserFullPermissions").mockResolvedValue({
      userId: "user-1",
      accountOwnerId: "user-1",
      groupPermissions: [],
      additionalPermissions: [Permission.RELAY_TOKEN_READ],
      removedPermissions: [],
      effectivePermissions: [Permission.RELAY_TOKEN_READ],
    });
    await expect(oauthScopeService.normalizeAndAssertGrantable("user-1", ["relay:usage:read"])).resolves.toEqual([
      "relay:usage:read",
    ]);
  });
  it("never borrows user permissions outside the requested AssumeRole session", async () => {
    const full = vi.spyOn(permissionService, "getUserFullPermissions").mockImplementation(async (_userId, options) => ({
      userId: "user-1",
      accountOwnerId: "user-1",
      groupPermissions: [],
      additionalPermissions: [],
      removedPermissions: [],
      effectivePermissions: options?.assumedRoleSessionId ? [] : [Permission.RELAY_TOKEN_CREATE],
    }));
    await expect(
      oauthScopeService.normalizeAndAssertGrantable("user-1", [Permission.RELAY_TOKEN_CREATE]),
    ).resolves.toEqual([Permission.RELAY_TOKEN_CREATE]);
    await expect(
      oauthScopeService.normalizeAndAssertGrantable("user-1", [Permission.RELAY_TOKEN_CREATE], {
        assumedRoleSessionId: "narrow-role",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(full).toHaveBeenLastCalledWith("user-1", { assumedRoleSessionId: "narrow-role" });
  });
  it("registers the existing Auth Center management scope with a single read-permission alias", () => {
    const definition = getOAuthScopeDefinition("auth_center_client");
    expect(definition).toMatchObject({
      category: "auth_center",
      requiredPermissions: [Permission.AUTH_CENTER_CLIENT_READ],
      riskLevel: "high",
    });
    expect(getOAuthScopeAliases("auth_center_client")).toEqual([
      "auth_center_client",
      Permission.AUTH_CENTER_CLIENT_READ,
    ]);
    expect(getOAuthScopeAliases(Permission.AUTH_CENTER_CLIENT_READ)).toContain("auth_center_client");
    for (const unrelated of [
      "oauth_client",
      Permission.AUTH_CENTER_CLIENT_CREATE,
      Permission.AUTH_CENTER_CLIENT_DELETE,
    ])
      expect(getOAuthScopeAliases(unrelated)).not.toContain("auth_center_client");
  });
  it("permits Auth Center scope issuance only when the current principal has its prerequisite", async () => {
    const permissions = vi.spyOn(permissionService, "getUserFullPermissions");
    permissions.mockResolvedValue({
      userId: "actor",
      accountOwnerId: "owner",
      groupPermissions: [],
      additionalPermissions: [],
      removedPermissions: [],
      effectivePermissions: [Permission.AUTH_CENTER_CLIENT_READ],
    });
    await expect(
      oauthScopeService.normalizeAndAssertGrantable("actor", ["auth_center_client", "auth_center_client"]),
    ).resolves.toEqual(["auth_center_client"]);
    permissions.mockResolvedValue({
      userId: "actor",
      accountOwnerId: "owner",
      groupPermissions: [],
      additionalPermissions: [],
      removedPermissions: [],
      effectivePermissions: [],
    });
    await expect(oauthScopeService.normalizeAndAssertGrantable("actor", ["auth_center_client"])).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it("does not use the account user's broader grant for Auth Center scope issuance in a role session", async () => {
    const permissions = vi
      .spyOn(permissionService, "getUserFullPermissions")
      .mockImplementation(async (_userId, options) => ({
        userId: "actor",
        accountOwnerId: "owner",
        groupPermissions: [],
        additionalPermissions: [],
        removedPermissions: [],
        effectivePermissions: options?.assumedRoleSessionId ? [] : [Permission.AUTH_CENTER_CLIENT_READ],
      }));
    await expect(
      oauthScopeService.normalizeAndAssertGrantable("actor", ["auth_center_client"], {
        assumedRoleSessionId: "restricted-role",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(permissions).toHaveBeenLastCalledWith("actor", { assumedRoleSessionId: "restricted-role" });
  });
});
