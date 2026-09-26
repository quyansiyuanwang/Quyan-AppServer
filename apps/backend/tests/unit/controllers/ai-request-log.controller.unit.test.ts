import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIRequestLogController } from "@/api/controllers/v1/relay/ai-request-log.controller";
import { AIRequestLogService } from "@/services/relay/ai-request-log.service";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@/constant/permission";
import { ForbiddenError } from "@/util/errors";

describe("AIRequestLogController permissions", () => {
  const serviceMock = {
    query: vi.fn(),
    findById: vi.fn(),
  };
  const permissionServiceMock = {
    checkUserPermissions: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(AIRequestLogService, "getInstance").mockReturnValue(serviceMock as unknown as AIRequestLogService);
    vi.spyOn(PermissionService, "getInstance").mockReturnValue(permissionServiceMock as unknown as PermissionService);
  });

  it("requires the dedicated AI request log permission", async () => {
    permissionServiceMock.checkUserPermissions.mockResolvedValue({
      hasPermission: false,
      missingPermissions: [Permission.RELAY_AI_REQUEST_LOG_READ],
    });
    const controller = new AIRequestLogController();
    const request = { user: { userId: "operator-1" } } as any;

    await expect(controller.list(request)).rejects.toBeInstanceOf(ForbiddenError);
    expect(permissionServiceMock.checkUserPermissions).toHaveBeenCalledWith(
      "operator-1",
      [Permission.RELAY_AI_REQUEST_LOG_READ],
      expect.objectContaining({ assumedRoleSessionId: undefined }),
    );
    expect(serviceMock.query).not.toHaveBeenCalled();
  });

  it("delegates list queries after authorization succeeds", async () => {
    permissionServiceMock.checkUserPermissions.mockResolvedValue({
      hasPermission: true,
      missingPermissions: [],
    });
    serviceMock.query.mockResolvedValue({ items: [], total: 0 });
    const controller = new AIRequestLogController();
    const request = { user: { userId: "operator-1" } } as any;

    await expect(controller.list(request, 2, 50, "alice")).resolves.toEqual({
      items: [],
      total: 0,
      page: 2,
      pageSize: 50,
    });
    expect(serviceMock.query).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 50, user: "alice" }));
  });
});
