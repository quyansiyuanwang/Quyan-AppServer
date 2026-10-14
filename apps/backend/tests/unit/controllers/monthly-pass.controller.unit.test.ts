import { env } from "@/config/env";
import { iamAuthenticatedAuthorizationMiddleware } from "@/iam/middleware/iam-authorization.middleware";
import { platformMonthlyPassTemplateWriteResource } from "@/iam/request/platform-monthly-pass-template-write-resource-resolvers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonthlyPassController } from "../../../src/api/controllers/v1/billing/monthly-pass.controller";
import { MonthlyPassService } from "../../../src/services/billing/monthly-pass.service";
import { PermissionService } from "../../../src/services/users/permission.service";
import { MANAGED_STATUS } from "../../../src/constant/status";
const originalMode = env.security.iamAuthorizationMode;

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
    env.security.iamAuthorizationMode = "enforce";
    vi.spyOn(MonthlyPassService, "getInstance").mockReturnValue(
      monthlyPassServiceMock as unknown as MonthlyPassService,
    );
    vi.spyOn(PermissionService, "getInstance").mockReturnValue(permissionServiceMock as unknown as PermissionService);
    permissionServiceMock.checkUserPermissions.mockResolvedValue({ hasPermission: true, missingPermissions: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.security.iamAuthorizationMode = originalMode;
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

  it("rejects PublishTemplate before entering the handler when JWT context is missing", async () => {
    const authorize = vi.fn(),
      next = vi.fn();
    const middleware = iamAuthenticatedAuthorizationMiddleware(
      {
        action: "quyan:monthly_pass:PublishTemplate",
        resourceKind: "single-resource",
        resource: platformMonthlyPassTemplateWriteResource,
      },
      { authorize } as never,
    );
    await middleware({ params: { id: "template-1" } } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(authorize).not.toHaveBeenCalled();
    expect(monthlyPassServiceMock.publishTemplate).not.toHaveBeenCalled();
  });

  it("rejects PublishTemplate at the resource middleware before invoking the service", async () => {
    const authorize = vi
        .fn()
        .mockResolvedValue({ decision: "ExplicitDeny", reason: "fixture-deny", matchedStatements: [] }),
      next = vi.fn();
    const middleware = iamAuthenticatedAuthorizationMiddleware(
      {
        action: "quyan:monthly_pass:PublishTemplate",
        resourceKind: "single-resource",
        resource: platformMonthlyPassTemplateWriteResource,
      },
      { authorize } as never,
    );
    const request = {
      user: { userId: "actor-1" },
      authContext: { principalUserId: "actor-1", accountOwnerId: "owner" },
      params: { id: "template-1" },
      headers: {},
      secure: true,
    };
    await middleware(request as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, messageKey: "permission.insufficientPermission" }),
    );
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:monthly_pass:PublishTemplate",
        resource: "acs:platform:*:platform:monthly-pass-template/template-1",
      }),
    );
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

  it("rejects UnpublishTemplate before entering the handler when JWT context is missing", async () => {
    const authorize = vi.fn(),
      next = vi.fn();
    const middleware = iamAuthenticatedAuthorizationMiddleware(
      {
        action: "quyan:monthly_pass:UnpublishTemplate",
        resourceKind: "single-resource",
        resource: platformMonthlyPassTemplateWriteResource,
      },
      { authorize } as never,
    );
    await middleware({ params: { id: "template-1" } } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(authorize).not.toHaveBeenCalled();
    expect(monthlyPassServiceMock.unpublishTemplate).not.toHaveBeenCalled();
  });

  it("rejects UnpublishTemplate at the resource middleware before invoking the service", async () => {
    const authorize = vi
        .fn()
        .mockResolvedValue({ decision: "ExplicitDeny", reason: "fixture-deny", matchedStatements: [] }),
      next = vi.fn();
    const middleware = iamAuthenticatedAuthorizationMiddleware(
      {
        action: "quyan:monthly_pass:UnpublishTemplate",
        resourceKind: "single-resource",
        resource: platformMonthlyPassTemplateWriteResource,
      },
      { authorize } as never,
    );
    const request = {
      user: { userId: "actor-1" },
      authContext: { principalUserId: "actor-1", accountOwnerId: "owner" },
      params: { id: "template-1" },
      headers: {},
      secure: true,
    };
    await middleware(request as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, messageKey: "permission.insufficientPermission" }),
    );
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:monthly_pass:UnpublishTemplate",
        resource: "acs:platform:*:platform:monthly-pass-template/template-1",
      }),
    );
    expect(monthlyPassServiceMock.unpublishTemplate).not.toHaveBeenCalled();
  });
});
