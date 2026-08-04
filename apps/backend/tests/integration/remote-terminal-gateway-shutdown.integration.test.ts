import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { RemoteTerminalGatewayBootstrap } from "@/modules/remote-terminal/gateway/bootstrap";

describe("RemoteTerminalGatewayBootstrap graceful close", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve())));
  });

  it("closes connected websocket clients with the server shutdown close code", async () => {
    const bootstrap = new RemoteTerminalGatewayBootstrap({
      getSessionGateway: () => ({ attachBrowser: () => undefined }),
    } as any);
    server = createServer();
    server.on("upgrade", (request, socket, head) => {
      if (!bootstrap.handleUpgrade(request, socket, head)) socket.destroy();
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Failed to bind WebSocket test server");

    const client = new WebSocket(
      `ws://127.0.0.1:${address.port}/remote-terminal/ws?role=browser&sessionId=session-1&browserToken=token-1`,
    );
    await once(client, "open");

    const closeEvent = once(client, "close");
    await bootstrap.close();
    const [code, reason] = await closeEvent;

    expect(code).toBe(1001);
    expect(Buffer.from(reason).toString()).toBe("Server shutting down");
  });
});