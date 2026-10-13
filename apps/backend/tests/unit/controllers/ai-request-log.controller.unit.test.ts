const iamMock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/services/relay/platform-ai-request-log-read-iam.service", () => ({
  PlatformAiRequestLogReadIamService: { getInstance: () => iamMock },
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIRequestLogController } from "@/api/controllers/v1/relay/ai-request-log.controller";
import { AIRequestLogService } from "@/services/relay/ai-request-log.service";
import { PermissionService } from "@/services/users/permission.service";
import { Permission } from "@/constant/permission";
import { setRequestContext } from "@/util/request-context";
import { ForbiddenError } from "@/util/errors";

describe("AIRequestLogController permissions", () => {
  const serviceMock = {
    query: vi.fn(),
    findById: vi.fn(),
    metadata: vi.fn(),
    content: vi.fn(),
    search: vi.fn(),
    attempts: vi.fn(),
  };
  const permissionServiceMock = {
    checkUserPermissions: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    iamMock.read.mockImplementation(async (_action, _id, _request, hydrate) => hydrate());
    setRequestContext({ user: { userId: "operator-1" } } as any);
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
  it("uses the diagnostics guard for attempts and attempt search without loading denied contents", async () => {
    iamMock.read.mockRejectedValue(
      new ForbiddenError("fixture denied", undefined, { messageKey: "permission.insufficientPermission" }),
    );
    const controller = new AIRequestLogController(),
      request = { user: { userId: "operator-1" } } as any;
    await expect(controller.attempts(request, "log-1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(serviceMock.attempts).not.toHaveBeenCalled();
    await expect(controller.search(request, "log-1", "text", "attempts")).rejects.toBeInstanceOf(ForbiddenError);
    expect(iamMock.read).toHaveBeenLastCalledWith(
      "quyan:relay:ai_request_log:SearchContent",
      "log-1",
      request,
      expect.any(Function),
      true,
    );
    expect(serviceMock.search).not.toHaveBeenCalled();
  });
  it("allows metadata and body search without granting diagnostic/topology access", async () => {
    setRequestContext({ user: { userId: "operator-1" } } as any);
    permissionServiceMock.checkUserPermissions.mockResolvedValue({ hasPermission: true });
    serviceMock.metadata.mockResolvedValue({ id: "log-1", availableSides: [] });
    serviceMock.search.mockResolvedValue({ items: [], total: 0 });
    const controller = new AIRequestLogController();
    await expect(controller.metadata({ user: { userId: "operator-1" } } as any, "log-1")).resolves.toEqual({
      id: "log-1",
      availableSides: [],
    });
    await controller.search({ user: { userId: "operator-1" } } as any, "log-1", "text", "request");
    expect(serviceMock.search).toHaveBeenCalledWith("log-1", "request", "text", expect.any(Object));
    expect(serviceMock.findById).not.toHaveBeenCalled();
  });
});
