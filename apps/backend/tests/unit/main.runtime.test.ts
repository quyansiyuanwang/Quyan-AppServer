import { beforeEach, describe, expect, it, vi } from "vitest";

describe("main runtime bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("forces process exit with code 1 when graceful shutdown timeout elapses", async () => {
    const setupService = vi.fn();
    const close = vi.fn();
    const serverOn = vi.fn();
    const handleUpgrade = vi.fn(() => true);
    const getGatewayServiceInstance = vi.fn(() => ({}));
    const server = {
      close,
      on: serverOn,
      keepAliveTimeout: 0,
      headersTimeout: 0,
      requestTimeout: 0,
    };
    const listen = vi.fn((port: number, callback?: () => void) => {
      callback?.();
      return server;
    });
    const createApp = vi.fn(() => ({ listen }));

    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const logger = { info, warn, error };

    const handlers = new Map<string, () => void>();
    vi.spyOn(process, "on").mockImplementation(((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return process;
    }) as typeof process.on);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    let forcedShutdownCallback: (() => void) | undefined;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void) => {
      forcedShutdownCallback = callback;
      return 0;
    }) as unknown as typeof setTimeout);

    const processWithSend = process as typeof process & { send?: (message: string) => void };
    const originalSend = processWithSend.send;
    processWithSend.send = undefined;

    vi.doMock("../../src/app", () => ({
      createApp,
      setupService,
    }));
    vi.doMock("../../src/config/env", () => ({
      EnvSpace: {
        port: 10001,
        isDevelopment: false,
        hiddenDatabase: "mysql://root:****@localhost:3306/app_test",
      },
    }));
    vi.doMock("../../src/util/logger", () => ({
      LogCategory: { UTIL: "UTIL" },
      getLogger: vi.fn(() => logger),
    }));
    vi.doMock("../../src/modules/remote-terminal/gateway/gateway.service", () => ({
      RemoteTerminalGatewayService: {
        getInstance: getGatewayServiceInstance,
      },
    }));
    vi.doMock("../../src/modules/remote-terminal/gateway/bootstrap", () => ({
      RemoteTerminalGatewayBootstrap: vi.fn(
        class {
          public handleUpgrade = handleUpgrade;
        },
      ),
    }));

    try {
      await import("../../src/main");

      expect(getGatewayServiceInstance).toHaveBeenCalledTimes(1);
      expect(serverOn).toHaveBeenCalledWith("upgrade", expect.any(Function));

      handlers.get("SIGINT")?.();
      expect(info).toHaveBeenCalledWith("SIGINT received, starting graceful shutdown");
      expect(close).toHaveBeenCalledTimes(1);

      expect(forcedShutdownCallback).toBeTypeOf("function");
      forcedShutdownCallback?.();

      expect(error).toHaveBeenCalledWith("Forced shutdown after timeout");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    } finally {
      processWithSend.send = originalSend;
    }
  });

  it("boots server, sets timeouts, sends PM2 ready signal, and registers shutdown hooks", async () => {
    const setupService = vi.fn();
    const close = vi.fn((callback?: () => void) => callback?.());
    const serverOn = vi.fn();
    const handleUpgrade = vi.fn(() => true);
    const getGatewayServiceInstance = vi.fn(() => ({}));
    const server = {
      close,
      on: serverOn,
      keepAliveTimeout: 0,
      headersTimeout: 0,
      requestTimeout: 0,
    };
    const listen = vi.fn((port: number, callback?: () => void) => {
      callback?.();
      return server;
    });
    const createApp = vi.fn(() => ({ listen }));

    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const logger = { info, warn, error };

    const handlers = new Map<string, () => void>();
    const processOnSpy = vi.spyOn(process, "on").mockImplementation(((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return process;
    }) as typeof process.on);
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((() => 0) as never);

    const processWithSend = process as typeof process & { send?: (message: string) => void };
    const originalSend = processWithSend.send;
    processWithSend.send = vi.fn();

    vi.doMock("../../src/app", () => ({
      createApp,
      setupService,
    }));
    vi.doMock("../../src/config/env", () => ({
      EnvSpace: {
        port: 10001,
        isDevelopment: true,
        hiddenDatabase: "mysql://root:****@localhost:3306/app_test",
      },
    }));
    vi.doMock("../../src/util/logger", () => ({
      LogCategory: { UTIL: "UTIL" },
      getLogger: vi.fn(() => logger),
    }));
    vi.doMock("../../src/modules/remote-terminal/gateway/gateway.service", () => ({
      RemoteTerminalGatewayService: {
        getInstance: getGatewayServiceInstance,
      },
    }));
    vi.doMock("../../src/modules/remote-terminal/gateway/bootstrap", () => ({
      RemoteTerminalGatewayBootstrap: vi.fn(
        class {
          public handleUpgrade = handleUpgrade;
        },
      ),
    }));

    try {
      await import("../../src/main");

      expect(createApp).toHaveBeenCalledTimes(1);
      expect(setupService).toHaveBeenCalledTimes(1);
      expect(getGatewayServiceInstance).toHaveBeenCalledTimes(1);
      expect(listen).toHaveBeenCalledWith(10001, expect.any(Function));
      expect(serverOn).toHaveBeenCalledWith("upgrade", expect.any(Function));

      expect(server.keepAliveTimeout).toBe(65 * 1000);
      expect(server.headersTimeout).toBe(66 * 1000);
      expect(server.requestTimeout).toBe(10 * 60 * 1000);

      expect(warn).toHaveBeenCalledWith("Running in development mode");
      expect(processWithSend.send).toHaveBeenCalledWith("ready");
      expect(info).toHaveBeenCalledWith("Sent 'ready' signal to PM2");

      expect(processOnSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
      expect(processOnSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));

      handlers.get("SIGTERM")?.();

      expect(info).toHaveBeenCalledWith("SIGTERM received, starting graceful shutdown");
      expect(close).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith("HTTP server closed");
      expect(processExitSpy).toHaveBeenCalledWith(0);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 12 * 60 * 1000);
    } finally {
      processWithSend.send = originalSend;
    }
  });
});
