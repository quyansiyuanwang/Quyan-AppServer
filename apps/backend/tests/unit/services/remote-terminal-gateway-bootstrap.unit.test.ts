import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { RemoteTerminalGatewayBootstrap } from "@/modules/remote-terminal/gateway/bootstrap";

describe("RemoteTerminalGatewayBootstrap browser upgrade failures", () => {
  it("closes upgraded browser websocket with policy violation for attach errors", async () => {
    const close = vi.fn();
    const websocket = { close } as any;
    const handleUpgrade = vi
      .spyOn(WebSocketServer.prototype, "handleUpgrade")
      .mockImplementation((_request, _socket, _head, callback) => {
        callback(websocket, _request);
        return undefined as any;
      })
      .mockName("handleUpgrade");

    const attachAuthorizedBrowser = vi.fn(() => {
      throw new Error("Unknown session.");
    });
    const gatewayService = {
      getDeviceRegistry: vi.fn(),
      getSessionGateway: vi.fn(() => ({
        attachAuthorizedBrowser,
      })),
    } as any;

    const bootstrap = new RemoteTerminalGatewayBootstrap(gatewayService);
    const request = {
      headers: { host: "localhost:10001" },
      url: "/remote-terminal/ws?role=browser&sessionId=s-1&browserToken=t-1",
    } as IncomingMessage;
    const socket = { destroy: vi.fn() } as unknown as Duplex;

    expect(bootstrap.handleUpgrade(request, socket, Buffer.alloc(0))).toBe(true);
    expect(attachAuthorizedBrowser).toHaveBeenCalledWith("s-1", "t-1", websocket, { "acs:SecureTransport": false });
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1008, "Unknown session."));

    handleUpgrade.mockRestore();
  });

  it("closes duplicate browser attach with the thrown reason", async () => {
    const close = vi.fn();
    const websocket = { close } as any;
    const handleUpgrade = vi
      .spyOn(WebSocketServer.prototype, "handleUpgrade")
      .mockImplementation((_request, _socket, _head, callback) => {
        callback(websocket, _request);
        return undefined as any;
      })
      .mockName("handleUpgrade");

    const attachAuthorizedBrowser = vi.fn(() => {
      throw new Error("Session already has an attached browser.");
    });
    const gatewayService = {
      getDeviceRegistry: vi.fn(),
      getSessionGateway: vi.fn(() => ({
        attachAuthorizedBrowser,
      })),
    } as any;

    const bootstrap = new RemoteTerminalGatewayBootstrap(gatewayService);
    const request = {
      headers: { host: "localhost:10001" },
      url: "/remote-terminal/ws?role=browser&sessionId=s-1&browserToken=t-1",
    } as IncomingMessage;
    const socket = { destroy: vi.fn() } as unknown as Duplex;

    expect(bootstrap.handleUpgrade(request, socket, Buffer.alloc(0))).toBe(true);
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith(1008, "Session already has an attached browser."));

    handleUpgrade.mockRestore();
  });
});
