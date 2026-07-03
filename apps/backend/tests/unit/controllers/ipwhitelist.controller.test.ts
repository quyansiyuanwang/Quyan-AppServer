import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPWhitelistController } from "../../../src/api/controllers/v1/system/ipwhitelist.controller";
import { IPWhiteListService } from "../../../src/services/system/ipwhitelist.service";
import { PermissionService } from "../../../src/services/users/permission.service";
import { setRequestContext } from "../../../src/util/request-context";

describe("IPWhitelistController", () => {
  const ipWhiteListServiceMock = {
    list: vi.fn(),
    isWhitelisted: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
  };
  const permissionServiceMock = {
    checkUserPermissions: vi.fn(),
    hasAnyPermission: vi.fn(),
  };

  const now = new Date("2026-05-17T12:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(IPWhiteListService, "getInstance").mockReturnValue(
      ipWhiteListServiceMock as unknown as IPWhiteListService,
    );
    vi.spyOn(PermissionService, "getInstance").mockReturnValue(permissionServiceMock as unknown as PermissionService);
    permissionServiceMock.checkUserPermissions.mockResolvedValue({ hasPermission: true, missingPermissions: [] });
  });

  it("maps whitelist records without losing controller context", async () => {
    ipWhiteListServiceMock.list.mockResolvedValue({
      whitelists: [
        {
          id: "wl-1",
          ipAddress: "127.0.0.1",
          reason: "local",
          addedBy: "user-1",
          expiresAt: now,
          createTime: now,
          updateTime: now,
        },
      ],
      total: 1,
    });

    const controller = new IPWhitelistController();
    setRequestContext({ user: { userId: "admin-1" } } as any);
    const result = await controller.getAllIPWhitelists(10, 0);

    expect(ipWhiteListServiceMock.list).toHaveBeenCalledWith(10, 0);
    expect(permissionServiceMock.checkUserPermissions).toHaveBeenCalledWith(
      "admin-1",
      expect.any(Array),
      expect.any(Object),
    );
    expect(result).toEqual({
      whitelists: [
        {
          id: "wl-1",
          ipAddress: "127.0.0.1",
          reason: "local",
          addedBy: "user-1",
          expiresAt: now.toISOString(),
          createTime: now.toISOString(),
          updateTime: now.toISOString(),
        },
      ],
      total: 1,
    });
  });
});
