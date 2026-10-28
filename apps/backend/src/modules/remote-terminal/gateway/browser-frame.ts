import { z } from "zod";
import type { RemoteTerminalBrowserToServerMessage } from "../protocol";
export const TERMINAL_BROWSER_FRAME_LIMITS = Object.freeze({ frameBytes: 1024 * 1024, maximumDimension: 4096 });
const sessionId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const dimension = z.number().int().min(1).max(TERMINAL_BROWSER_FRAME_LIMITS.maximumDimension);
const browserFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session-input"), sessionId, data: z.string() }).strict(),
  z.object({ type: z.literal("session-resize"), sessionId, cols: dimension, rows: dimension }).strict(),
  z.object({ type: z.literal("session-stop"), sessionId }).strict(),
  z
    .object({ type: z.literal("browser-ping"), ts: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER) })
    .strict(),
]);
/** The socket's authenticated session is the only command target; frames cannot choose another one. */
export function parseTerminalBrowserFrame(
  raw: string,
  authenticatedSessionId: string,
): RemoteTerminalBrowserToServerMessage | null {
  if (Buffer.byteLength(raw, "utf8") > TERMINAL_BROWSER_FRAME_LIMITS.frameBytes) return null;
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = browserFrame.safeParse(input);
  if (!parsed.success) return null;
  const frame = parsed.data;
  if (frame.type !== "browser-ping" && frame.sessionId !== authenticatedSessionId) return null;
  return frame;
}
