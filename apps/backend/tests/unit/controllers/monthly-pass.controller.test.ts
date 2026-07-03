import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonthlyPassController } from "../../../src/api/controllers/v1/billing/monthly-pass.controller";
import { MonthlyPassService } from "../../../src/services/billing/monthly-pass.service";
import { PermissionService } from "../../../src/services/users/permission.service";
import { MANAGED_STATUS } from "../../../src/constant/status";
import { ForbiddenError } from "../../../src/util/errors";

describe("MonthlyPassController publish endpoints", () => {
  const now = new Date("2026-05-07T12:00:00.000Z");
  const publishedTemplate = {
    id: "template-1",
    name: "Starter Pack",
    description: "starter",
    publishStatus: "published" as const,
    publishedAt: now,
    defaultQuota: 12.5,
    quotaUnit: "amount" as const,
    status: MANAGED_STATUS.ENABLED,
    createTime: now,
    updateTime: now,
  };
  const draftTemplate = {
    ...publishedTemplate,
    publishStatus: "draft" as const,
    publishedAt: undefined,
  };

  const monthlyPassServiceMock = {
    listPublishedTemplates: vi.fn(),
    publishTemplate: vi.fn(),
    unpublishTemplate: vi.fn(),
  };
  const permissionServiceMock = {
    checkUserPermissions: vi.fn(),
    hasAnyPermission: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(MonthlyPassService, "getInstance").mockReturnValue(
      monthlyPassServiceMock as unknown as MonthlyPassService,
    );
    vi.spyOn(PermissionService, "getInstance").mockReturnValue(permissionServiceMock as unknown as PermissionService);
    permissionServiceMock.checkUserPermissions.mockResolvedValue({ hasPermission: true, missingPermissions: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists published templates from service", async () => {
    monthlyPassServiceMock.listPublishedTemplates.mockResolvedValue([publishedTemplate]);
    const controller = new MonthlyPassController();

    const result = await controller.listPublishedTemplates();

    expect(monthlyPassServiceMock.listPublishedTemplates).toHaveBeenCalledTimes(1);
    expect(result).toEqual([publishedTemplate]);
  });

  it("publishes template with request user context", async () => {
    monthlyPassServiceMock.publishTemplate.mockResolvedValue(publishedTemplate);
    const controller = new MonthlyPassController();
    const request = { user: { userId: "actor-1" } } as any;

    const result = await controller.publishTemplate("template-1", request);

    expect(monthlyPassServiceMock.publishTemplate).toHaveBeenCalledWith("template-1", "actor-1", request);
    expect(result).toEqual(publishedTemplate);
  });

  it("rejects publish when request user is missing", async () => {
    const controller = new MonthlyPassController();

    await expect(controller.publishTemplate("template-1", {} as any)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(controller.publishTemplate("template-1", {} as any)).rejects.toMatchObject({
      message: "未授权访问，请先登录",
    });
    expect(monthlyPassServiceMock.publishTemplate).not.toHaveBeenCalled();
  });

  it("rejects publish when permission check fails", async () => {
    permissionServiceMock.checkUserPermissions.mockResolvedValueOnce({
      hasPermission: false,
      missingPermissions: ["monthly_pass:template:write"],
    });
    const controller = new MonthlyPassController();
    const request = { user: { userId: "actor-1" } } as any;

    await expect(controller.publishTemplate("template-1", request)).rejects.toMatchObject({
      name: "Error",
      message: "缺少必要权限: monthly_pass:template:write",
    });
    expect(monthlyPassServiceMock.publishTemplate).not.toHaveBeenCalled();
  });

  it("unpublishes template with request user context", async () => {
    monthlyPassServiceMock.unpublishTemplate.mockResolvedValue(draftTemplate);
    const controller = new MonthlyPassController();
    const request = { user: { userId: "actor-2" } } as any;

    const result = await controller.unpublishTemplate("template-1", request);

    expect(monthlyPassServiceMock.unpublishTemplate).toHaveBeenCalledWith("template-1", "actor-2", request);
    expect(result).toEqual(draftTemplate);
  });

  it("rejects unpublish when request user is missing", async () => {
    const controller = new MonthlyPassController();

    await expect(controller.unpublishTemplate("template-1", {} as any)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(controller.unpublishTemplate("template-1", {} as any)).rejects.toMatchObject({
      message: "未授权访问，请先登录",
    });
    expect(monthlyPassServiceMock.unpublishTemplate).not.toHaveBeenCalled();
  });

  it("rejects unpublish when permission check fails", async () => {
    permissionServiceMock.checkUserPermissions.mockResolvedValueOnce({
      hasPermission: false,
      missingPermissions: ["monthly_pass:template:write"],
    });
    const controller = new MonthlyPassController();
    const request = { user: { userId: "actor-2" } } as any;

    await expect(controller.unpublishTemplate("template-1", request)).rejects.toMatchObject({
      name: "Error",
      message: "缺少必要权限: monthly_pass:template:write",
    });
    expect(monthlyPassServiceMock.unpublishTemplate).not.toHaveBeenCalled();
  });
});
