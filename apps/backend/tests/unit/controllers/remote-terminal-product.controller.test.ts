import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteTerminalProductController } from "../../../src/api/controllers/v1/remote-terminal/remote-terminal-product.controller";
import { RemoteTerminalProductService } from "../../../src/services/remote-terminal/remote-terminal-product.service";
import { PermissionService } from "../../../src/services/users/permission.service";

describe("RemoteTerminalProductController permissions", () => {
  const remoteTerminalProductServiceMock = {
    listDevices: vi.fn(),
    getFilterOptions: vi.fn(),
  };
  const permissionServiceMock = {
    checkUserPermissions: vi.fn(),
    hasAnyPermission: vi.fn(),
  };
  const request = { user: { userId: "user-1" } } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(RemoteTerminalProductService, "getInstance").mockReturnValue(
      remoteTerminalProductServiceMock as unknown as RemoteTerminalProductService,
    );
    vi.spyOn(PermissionService, "getInstance").mockReturnValue(permissionServiceMock as unknown as PermissionService);
    permissionServiceMock.checkUserPermissions.mockResolvedValue({
      hasPermission: true,
      missingPermissions: [],
      checkedPermissions: [],
    });
    permissionServiceMock.hasAnyPermission.mockResolvedValue(true);
    remoteTerminalProductServiceMock.listDevices.mockResolvedValue({ total: 0, records: [] });
    remoteTerminalProductServiceMock.getFilterOptions.mockResolvedValue({
      templateStatusOptions: [],
      assignmentStatusOptions: [],
      deviceStatusOptions: [],
      publishStatusOptions: [],
      templates: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires device write permission for management device list", async () => {
    permissionServiceMock.checkUserPermissions.mockResolvedValueOnce({
      hasPermission: false,
      missingPermissions: ["remote_terminal:device:manage:read"],
      checkedPermissions: ["remote_terminal:device:manage:read"],
    });
    const controller = new RemoteTerminalProductController();

    await expect(
      (controller as any).listDevices(undefined, undefined, undefined, undefined, undefined, request),
    ).rejects.toMatchObject({
      message: "缺少必要权限: remote_terminal:device:manage:read",
    });
    expect(remoteTerminalProductServiceMock.listDevices).not.toHaveBeenCalled();
  });

  it("requires device write or other management permission for filter options", async () => {
    permissionServiceMock.checkUserPermissions.mockResolvedValueOnce({
      hasPermission: false,
      missingPermissions: [
        "remote_terminal:product:read",
        "remote_terminal:assignment:read",
        "remote_terminal:device:manage:read",
      ],
      checkedPermissions: [
        "remote_terminal:product:read",
        "remote_terminal:assignment:read",
        "remote_terminal:device:manage:read",
      ],
    });
    const controller = new RemoteTerminalProductController();

    await expect((controller as any).getFilterOptions(request)).rejects.toMatchObject({
      message:
        "需要以下权限之一: remote_terminal:product:read, remote_terminal:assignment:read, remote_terminal:device:manage:read",
    });
    expect(remoteTerminalProductServiceMock.getFilterOptions).not.toHaveBeenCalled();
  });
});
