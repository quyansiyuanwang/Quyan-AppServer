import { describe, expect, it } from "vitest";
import { isRemoteTerminalWebSocketPath } from "@/modules/remote-terminal/gateway/bootstrap";

describe("isRemoteTerminalWebSocketPath", () => {
  it.each(["/remote-terminal/ws", "/v1/remote-terminal/ws"])("accepts %s", (pathname) => {
    expect(isRemoteTerminalWebSocketPath(pathname)).toBe(true);
  });

  it.each(["/remote-terminal/ws/", "/v1/remote-terminal/agent/ws", "/v1/remote-terminal/wsx"])(
    "rejects %s",
    (pathname) => {
      expect(isRemoteTerminalWebSocketPath(pathname)).toBe(false);
    },
  );
});