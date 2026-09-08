import { Permission, getOAuthScopeCatalog, getOAuthScopeDefinition } from "@quyan/shared";
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
});
