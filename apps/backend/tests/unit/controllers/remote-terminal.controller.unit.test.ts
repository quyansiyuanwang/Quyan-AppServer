import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteTerminalController } from "../../../src/api/controllers/v1/remote-terminal/remote-terminal.controller";
import { RemoteTerminalService } from "../../../src/services/remote-terminal/remote-terminal.service";
import { PermissionService } from "../../../src/services/users/permission.service";
import type { TypedRequest } from "../../../src/types/express";

describe("RemoteTerminalController websocket URL generation", () => {
  const remoteTerminalServiceMock = {
    createSession: vi.fn(),
  };
  const permissionServiceMock = {
    checkUserPermissions: vi.fn(),
    hasAnyPermission: vi.fn(),
  };

  const makeRequest = (headers: Record<string, string>, protocol = "http") =>
    ({
      user: { userId: "user-1" },
      protocol,
      headers,
    }) as unknown as TypedRequest;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(PermissionService, "getInstance").mockReturnValue(permissionServiceMock as unknown as PermissionService);
    permissionServiceMock.checkUserPermissions.mockResolvedValue({ hasPermission: true, missingPermissions: [] });
    remoteTerminalServiceMock.createSession.mockResolvedValue({
      sessionId: "session-1",
      deviceId: "device-1",
      mode: "shell",
      shellType: "powershell",
      browserToken: "browser-token",
      websocketUrl: "wss://api.qysyw.cn/remote-terminal/ws?role=browser&sessionId=session-1",
      createdAt: "2026-06-11T12:00:00.000Z",
    });
    vi.spyOn(RemoteTerminalService, "getInstance").mockReturnValue(
      remoteTerminalServiceMock as unknown as RemoteTerminalService,
    );
  });

  it("prefers x-forwarded host and proto for https reverse proxies", async () => {
    const controller = new RemoteTerminalController();

    await controller.createSession(
      {
        deviceId: "device-1",
        mode: "shell",
        shellType: "powershell",
      },
      makeRequest({
        host: "localhost:10001",
        "x-forwarded-host": "api.qysyw.cn",
        "x-forwarded-proto": "https",
      }),
    );

    expect(remoteTerminalServiceMock.createSession).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ deviceId: "device-1" }),
      "wss://api.qysyw.cn/remote-terminal/ws",
    );
  });

  it("supports standard forwarded header when present", async () => {
    const controller = new RemoteTerminalController();

    await controller.createSession(
      {
        deviceId: "device-1",
        mode: "shell",
        shellType: "powershell",
      },
      makeRequest({
        host: "localhost:10001",
        forwarded: 'for=203.0.113.10;proto=https;host="api.qysyw.cn"',
      }),
    );

    expect(remoteTerminalServiceMock.createSession).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ deviceId: "device-1" }),
      "wss://api.qysyw.cn/remote-terminal/ws",
    );
  });

  it("falls back to direct request host for local http access", async () => {
    const controller = new RemoteTerminalController();

    await controller.createSession(
      {
        deviceId: "device-1",
        mode: "shell",
        shellType: "powershell",
      },
      makeRequest({
        host: "localhost:10001",
      }),
    );

    expect(remoteTerminalServiceMock.createSession).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ deviceId: "device-1" }),
      "ws://localhost:10001/remote-terminal/ws",
    );
  });
});
