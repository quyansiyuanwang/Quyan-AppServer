import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessKeyController } from "../../../src/api/controllers/v1/users/accesskey.controller";
import { AccessKeyService } from "../../../src/services/users/accesskey.service";
import { PermissionService } from "../../../src/services/users/permission.service";
import { ForbiddenError } from "../../../src/util/errors";

describe("AccessKeyController OAuth restrictions", () => {
  const accessKeyServiceMock = {
    generateKeyForUser: vi.fn(),
    listKeys: vi.fn(),
    listKeysPage: vi.fn(),
    revokeKey: vi.fn(),
    sendAccessKeyCreationVerificationCodeForUser: vi.fn(),
  };
  const permissionServiceMock = {
    checkUserPermissions: vi.fn(),
    hasAnyPermission: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(PermissionService, "getInstance").mockReturnValue(permissionServiceMock as unknown as PermissionService);
    permissionServiceMock.checkUserPermissions.mockResolvedValue({ hasPermission: true, missingPermissions: [] });
    vi.spyOn(AccessKeyService.prototype, "generateKeyForUser").mockImplementation(
      accessKeyServiceMock.generateKeyForUser,
    );
    vi.spyOn(AccessKeyService.prototype, "listKeys").mockImplementation(accessKeyServiceMock.listKeys);
    vi.spyOn(AccessKeyService.prototype, "listKeysPage").mockImplementation(accessKeyServiceMock.listKeysPage);
    vi.spyOn(AccessKeyService.prototype, "revokeKey").mockImplementation(accessKeyServiceMock.revokeKey);
    vi.spyOn(AccessKeyService.prototype, "sendAccessKeyCreationVerificationCodeForUser").mockImplementation(
      accessKeyServiceMock.sendAccessKeyCreationVerificationCodeForUser,
    );
  });

  it("allows OAuth-scoped creation flow to continue using authenticated user context", async () => {
    accessKeyServiceMock.generateKeyForUser.mockResolvedValue({ id: "ak-1", key: "ak_value" });
    const controller = new AccessKeyController();
    const request = {
      user: { userId: "user-1" },
      oauthAccessToken: { id: "oat-1", scopes: ["accesskey"] },
    } as any;

    const result = await controller.createAccessKey(request, { name: "Demo Key" } as any);

    expect(accessKeyServiceMock.generateKeyForUser).toHaveBeenCalledWith("user-1", { name: "Demo Key" }, request);
    expect(result).toEqual({ id: "ak-1", key: "ak_value" });
  });

  it("forwards trusted request context to the OAuth-compatible code-sending service", async () => {
    const req = { user: { userId: "user-1" }, oauthAccessToken: { id: "fixture", scopes: ["accesskey"] } } as any;
    accessKeyServiceMock.sendAccessKeyCreationVerificationCodeForUser.mockResolvedValue(true);
    await new AccessKeyController().sendAccessKeyCreationVerificationCode(req);
    expect(accessKeyServiceMock.sendAccessKeyCreationVerificationCodeForUser).toHaveBeenCalledWith("user-1", req);
  });

  it("rejects listing existing keys for OAuth-authorized third-party apps", async () => {
    const controller = new AccessKeyController();
    const request = {
      user: { userId: "user-1" },
      oauthAccessToken: { id: "oat-1", scopes: ["accesskey"] },
    } as any;

    await expect(controller.listAccessKeys(request)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(controller.listAccessKeys(request)).rejects.toMatchObject({
      message: "第三方应用无权读取已有 Access Key",
    });
    expect(accessKeyServiceMock.listKeys).not.toHaveBeenCalled();
  });

  it("allows first-party JWT users to list keys", async () => {
    accessKeyServiceMock.listKeys.mockResolvedValue([{ id: "ak-1", key: "ak_****" }]);
    const controller = new AccessKeyController();
    const request = {
      user: { userId: "user-1" },
    } as any;

    const result = await controller.listAccessKeys(request);

    expect(accessKeyServiceMock.listKeys).toHaveBeenCalledWith("user-1", request);
    expect(result).toEqual([{ id: "ak-1", key: "ak_****" }]);
  });

  it("forwards page arguments and trusted identity to the service", async () => {
    const controller = new AccessKeyController(),
      request = { user: { userId: "user-1" } } as any;
    accessKeyServiceMock.listKeysPage.mockResolvedValue({ items: [], page: 2, pageSize: 10, hasNext: true });
    expect(await controller.listAccessKeysPage(request, 2, 10)).toMatchObject({ page: 2, hasNext: true });
    expect(accessKeyServiceMock.listKeysPage).toHaveBeenCalledWith("user-1", { page: 2, pageSize: 10 }, request);
    request.oauthAccessToken = { id: "fixture" };
    await expect(controller.listAccessKeysPage(request, 2, 10)).rejects.toBeInstanceOf(ForbiddenError);
    expect(accessKeyServiceMock.listKeysPage).toHaveBeenCalledTimes(1);
  });

  it("rejects deleting existing keys for OAuth-authorized third-party apps", async () => {
    const controller = new AccessKeyController();
    const request = {
      user: { userId: "user-1" },
      oauthAccessToken: { id: "oat-1", scopes: ["accesskey"] },
    } as any;

    await expect(controller.deleteAccessKey(request, "ak-1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(controller.deleteAccessKey(request, "ak-1")).rejects.toMatchObject({
      message: "第三方应用无权删除已有 Access Key",
    });
    expect(accessKeyServiceMock.revokeKey).not.toHaveBeenCalled();
  });
});
