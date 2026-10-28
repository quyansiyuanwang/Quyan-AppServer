import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteTerminalProductController } from "../../../src/api/controllers/v1/remote-terminal/remote-terminal-product.controller";
import { RemoteTerminalProductService } from "../../../src/services/remote-terminal/remote-terminal-product.service";
import { PermissionService } from "../../../src/services/users/permission.service";

describe("RemoteTerminalProductController permissions", () => {
  const remoteTerminalProductServiceMock = {
    listDevices: vi.fn(),
    listEntitlements: vi.fn(),
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

  it("forwards trusted request and filters to native device collection admission", async () => {
    const controller = new RemoteTerminalProductController();
    await controller.listDevices(2, 10, "customer", "entitlement", 1, request);
    expect(remoteTerminalProductServiceMock.listDevices).toHaveBeenCalledWith(
      2,
      10,
      "customer",
      "entitlement",
      1,
      request,
    );
  });

  it("forwards pagination, search and authenticated context for native option authorization", async () => {
    const controller = new RemoteTerminalProductController();
    await controller.getFilterOptions(2, 20, "starter", request);
    expect(remoteTerminalProductServiceMock.getFilterOptions).toHaveBeenCalledWith(2, 20, "starter", request);
  });
  it("forwards the trusted request to native entitlement collection admission", async () => {
    const controller = new RemoteTerminalProductController();
    await controller.listEntitlements(2, 10, "customer", "template", 1, request);
    expect(remoteTerminalProductServiceMock.listEntitlements).toHaveBeenCalledWith(
      2,
      10,
      "customer",
      "template",
      1,
      request,
    );
  });
});
