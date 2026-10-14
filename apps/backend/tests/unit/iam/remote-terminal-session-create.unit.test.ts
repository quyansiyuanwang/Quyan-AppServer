import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/remote-terminal/remote-terminal-device-iam.service", () => ({
  RemoteTerminalDeviceIamService: { getInstance: vi.fn() },
}));
vi.mock("@/modules/remote-terminal/gateway/gateway.service", () => ({
  RemoteTerminalGatewayService: { getInstance: vi.fn() },
}));
vi.mock("@/services/remote-terminal/remote-terminal-product.service", () => ({
  RemoteTerminalProductService: { getInstance: vi.fn() },
}));
import { RemoteTerminalDeviceIamService } from "@/services/remote-terminal/remote-terminal-device-iam.service";
import { RemoteTerminalGatewayService } from "@/modules/remote-terminal/gateway/gateway.service";
import { RemoteTerminalProductService } from "@/services/remote-terminal/remote-terminal-product.service";
import { RemoteTerminalService } from "@/services/remote-terminal/remote-terminal.service";
import { ForbiddenError } from "@/util/errors";
import { env } from "@/config/env";
import type { TypedRequest } from "@/types/express";
import { getIamActionDefinition, iamActionsForLegacyPermission, Permission } from "@quyan/shared";
const mode = env.security.iamAuthorizationMode;
const nativeGateway = {
    closeAuthorizedPendingSessions: vi.fn(),
    listSessionMetadata: vi.fn(),
    discardPendingSession: vi.fn(),
  },
  gateway = {
    closeReconnectableSessions: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
    getSessionGateway: vi.fn(),
  },
  product = { getRuntimeTotalTerminalLimit: vi.fn() },
  bridge = { withDevice: vi.fn() },
  guard = vi.fn();
const body = { deviceId: "device-1", mode: "shell" as const, shellType: "bash" as const };
const request = () =>
  ({
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
  }) as unknown as TypedRequest;
const issued = {
  sessionId: "issued-session",
  deviceId: "device-1",
  mode: "shell" as const,
  shellType: "bash" as const,
  browserToken: "fixture-token",
  websocketUrl: "ws://fixture",
  createdAt: "2026-10-14T00:00:00.000Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  env.security.iamAuthorizationMode = "enforce";
  RemoteTerminalService["instance"] = null;
  vi.mocked(RemoteTerminalDeviceIamService.getInstance).mockReturnValue(
    bridge as unknown as RemoteTerminalDeviceIamService,
  );
  vi.mocked(RemoteTerminalGatewayService.getInstance).mockReturnValue(
    gateway as unknown as RemoteTerminalGatewayService,
  );
  vi.mocked(RemoteTerminalProductService.getInstance).mockReturnValue(
    product as unknown as RemoteTerminalProductService,
  );
  gateway.getSessionGateway.mockReturnValue(nativeGateway);
  guard.mockResolvedValue(undefined);
  bridge.withDevice.mockImplementation(async (_user, _device, _action, _request, operation) => {
    await guard();
    const result = await operation(guard);
    await guard();
    return result;
  });
  product.getRuntimeTotalTerminalLimit.mockResolvedValue(2);
  nativeGateway.closeAuthorizedPendingSessions.mockResolvedValue(undefined);
  nativeGateway.listSessionMetadata.mockResolvedValue([]);
  nativeGateway.discardPendingSession.mockResolvedValue(undefined);
  gateway.createSession.mockResolvedValue(issued);
  gateway.closeReconnectableSessions.mockResolvedValue(undefined);
  gateway.listSessions.mockResolvedValue([]);
});
afterEach(() => {
  env.security.iamAuthorizationMode = mode;
  vi.restoreAllMocks();
});
describe("device-authorized terminal session issuance", () => {
  it("declares a server Action that uses a selected device and write permission alias", () => {
    expect(getIamActionDefinition("quyan:remote_terminal:CreateSession")).toMatchObject({
      resourceTypes: ["remote-terminal/device"],
      accessLevel: "Write",
      sensitive: true,
    });
    expect(iamActionsForLegacyPermission(Permission.REMOTE_TERMINAL_SESSION_CREATE)).toContain(
      "quyan:remote_terminal:CreateSession",
    );
  });
  it("authorizes before quota reads or reconnect cleanup and passes a guard to native creation", async () => {
    const req = request();
    expect(await RemoteTerminalService.getInstance().createSession("actor", body, "ws://fixture", req)).toEqual(issued);
    expect(bridge.withDevice).toHaveBeenCalledWith(
      "actor",
      "device-1",
      "quyan:remote_terminal:CreateSession",
      req,
      expect.any(Function),
    );
    expect(guard.mock.invocationCallOrder[0]).toBeLessThan(
      product.getRuntimeTotalTerminalLimit.mock.invocationCallOrder[0],
    );
    expect(nativeGateway.closeAuthorizedPendingSessions).toHaveBeenCalledWith("actor", "device-1", guard);
    expect(gateway.createSession).toHaveBeenCalledWith("actor", body, "ws://fixture", guard);
    expect(gateway.listSessions).not.toHaveBeenCalled();
  });
  it("blocks all effects for an explicit policy denial", async () => {
    bridge.withDevice.mockRejectedValue(new ForbiddenError("fixture denial"));
    await expect(
      RemoteTerminalService.getInstance().createSession("actor", body, "ws://fixture", request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(product.getRuntimeTotalTerminalLimit).not.toHaveBeenCalled();
    expect(nativeGateway.closeAuthorizedPendingSessions).not.toHaveBeenCalled();
    expect(gateway.createSession).not.toHaveBeenCalled();
  });
  it("rechecks before pending cleanup", async () => {
    guard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ForbiddenError("fixture revocation"));
    await expect(
      RemoteTerminalService.getInstance().createSession("actor", body, "ws://fixture", request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(nativeGateway.closeAuthorizedPendingSessions).not.toHaveBeenCalled();
  });
  it("counts all owned sessions regardless of their list visibility", async () => {
    nativeGateway.listSessionMetadata.mockResolvedValue([
      { status: "pending" },
      { status: "connected" },
      { status: "closed" },
    ]);
    await expect(
      RemoteTerminalService.getInstance().createSession("actor", body, "ws://fixture", request()),
    ).rejects.toThrow("Terminal quota exceeded");
    expect(gateway.createSession).not.toHaveBeenCalled();
  });
  it("discards an issued pending capability when the final bridge recheck fails", async () => {
    bridge.withDevice.mockImplementation(async (_user, _device, _action, _request, operation) => {
      await operation(guard);
      throw new ForbiddenError("fixture revocation");
    });
    await expect(
      RemoteTerminalService.getInstance().createSession("actor", body, "ws://fixture", request()),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(nativeGateway.discardPendingSession).toHaveBeenCalledWith("actor", "issued-session");
  });
  it.each(["legacy", "shadow"] as const)("preserves %s data reads and performs a single issuance", async (selected) => {
    env.security.iamAuthorizationMode = selected;
    expect(await RemoteTerminalService.getInstance().createSession("actor", body, "ws://fixture", request())).toEqual(
      issued,
    );
    expect(gateway.closeReconnectableSessions).toHaveBeenCalledTimes(1);
    expect(gateway.listSessions).toHaveBeenCalledTimes(1);
    expect(gateway.createSession).toHaveBeenCalledWith("actor", body, "ws://fixture");
    expect(nativeGateway.closeAuthorizedPendingSessions).not.toHaveBeenCalled();
  });
});
