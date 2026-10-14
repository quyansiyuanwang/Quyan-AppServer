import { describe, expect, it } from "vitest";
import {
  parseTerminalBrowserFrame,
  TERMINAL_BROWSER_FRAME_LIMITS,
} from "@/modules/remote-terminal/gateway/browser-frame";
const parse = (input: unknown) => parseTerminalBrowserFrame(JSON.stringify(input), "session-1");
describe("authenticated terminal browser frame", () => {
  it.each([
    { type: "session-input", sessionId: "session-1", data: "printf hello\n\u001b[A" },
    { type: "session-resize", sessionId: "session-1", cols: 120, rows: 40 },
    { type: "session-stop", sessionId: "session-1" },
    { type: "browser-ping", ts: 1790000000000 },
  ])("preserves declared frame %j", (frame) => {
    expect(parse(frame)).toEqual(frame);
  });
  it.each(["session-input", "session-resize", "session-stop"])("rejects a forged session ID for %s", (type) => {
    const input = {
      type,
      sessionId: "session-2",
      ...(type === "session-input" ? { data: "danger" } : type === "session-resize" ? { cols: 80, rows: 25 } : {}),
    };
    expect(parse(input)).toBeNull();
  });
  it.each([
    { type: "session-start", sessionId: "session-1", mode: "shell", shellType: "bash" },
    { type: "preferences-get", requestId: "request-1" },
    { type: "preferences-set", requestId: "request-1", preferences: {} },
    { type: "directory-browse", requestId: "request-1" },
    { type: "session-input", sessionId: "session-1", data: "hello", accountId: "foreign" },
    { type: "session-input", sessionId: "session-1", data: 17 },
    { type: "session-resize", sessionId: "session-1", cols: 0, rows: 25 },
    { type: "session-resize", sessionId: "session-1", cols: 80.5, rows: 25 },
    { type: "session-resize", sessionId: "session-1", cols: 80, rows: 4097 },
    { type: "browser-ping", ts: "client-controlled" },
    { type: "browser-ping", ts: -1 },
    null,
    [],
    17,
  ])("rejects undeclared, malformed or overbroad frame %j", (frame) => {
    expect(parse(frame)).toBeNull();
  });
  it("rejects malformed JSON and UTF-8 payloads beyond the byte limit", () => {
    expect(parseTerminalBrowserFrame("{", "session-1")).toBeNull();
    expect(
      parse({
        type: "session-input",
        sessionId: "session-1",
        data: "中".repeat(TERMINAL_BROWSER_FRAME_LIMITS.frameBytes / 2),
      }),
    ).toBeNull();
  });
});
