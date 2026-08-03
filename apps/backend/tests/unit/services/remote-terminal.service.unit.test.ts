import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteTerminalGatewayService } from "@/modules/remote-terminal/gateway/gateway.service";
import { RemoteTerminalService } from "@/services/remote-terminal/remote-terminal.service";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";

describe("RemoteTerminalService reconnect quota handling", () => {
  const gatewayService = {
    closeReconnectableSessions: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
  };

  const productService = {
    getRuntimeTotalTerminalLimit: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    RemoteTerminalService["instance"] = null;
    gatewayService.closeReconnectableSessions.mockResolvedValue(undefined);
    gatewayService.listSessions.mockResolvedValue([]);
    gatewayService.createSession.mockResolvedValue({
      sessionId: "new-session",
      deviceId: "device-1",
      mode: "shell",
      shellType: "powershell",
      browserToken: "browser-token",
      websocketUrl: "ws://localhost/remote-terminal/ws?role=browser",
      createdAt: "2026-06-11T04:56:23.000Z",
    });
    productService.getRuntimeTotalTerminalLimit.mockResolvedValue(1);

    vi.spyOn(RemoteTerminalGatewayService, "getInstance").mockReturnValue(
      gatewayService as unknown as RemoteTerminalGatewayService,
    );
    vi.spyOn(RemoteTerminalProductService, "getInstance").mockReturnValue(
      productService as unknown as RemoteTerminalProductService,
    );
  });

  it("releases same-device stale session before quota check", async () => {
    gatewayService.listSessions.mockResolvedValueOnce([
      {
        sessionId: "old-session",
        deviceId: "device-1",
        mode: "shell",
        shellType: "powershell",
        status: "closed",
        createdAt: "2026-06-11T04:55:00.000Z",
      },
    ]);

    const service = RemoteTerminalService.getInstance();

    await expect(
      service.createSession(
        "user-1",
        {
          deviceId: "device-1",
          mode: "shell",
          shellType: "powershell",
        },
        "ws://localhost/remote-terminal/ws",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        sessionId: "new-session",
        deviceId: "device-1",
      }),
    );

    expect(gatewayService.closeReconnectableSessions).toHaveBeenCalledWith("user-1", "device-1");
    expect(gatewayService.createSession).toHaveBeenCalledTimes(1);
  });

  it("still blocks when another device consumes the only quota", async () => {
    gatewayService.listSessions.mockResolvedValueOnce([
      {
        sessionId: "other-device-session",
        deviceId: "device-2",
        mode: "shell",
        shellType: "powershell",
        status: "connected",
        createdAt: "2026-06-11T04:55:00.000Z",
      },
    ]);

    const service = RemoteTerminalService.getInstance();

    await expect(
      service.createSession(
        "user-1",
        {
          deviceId: "device-1",
          mode: "shell",
          shellType: "powershell",
        },
        "ws://localhost/remote-terminal/ws",
      ),
    ).rejects.toThrow("Terminal quota exceeded: 1/1 active sessions in use.");

    expect(gatewayService.closeReconnectableSessions).toHaveBeenCalledWith("user-1", "device-1");
    expect(gatewayService.createSession).not.toHaveBeenCalled();
  });
});
