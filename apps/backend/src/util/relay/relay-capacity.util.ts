import { env } from "@/config/env";
import { getAIResourceConfig } from "@/services/infrastructure/ai-resource-config.service";
import { PayloadTooLargeError, ContentSafetyBlockedError, GatewayTimeoutError } from "@/util/errors";
import type { RelayResponseLike } from "@/services/relay/types/relay-proxy.types";
import type { RelayRequestFormat } from "./relay-model-availability.util";

/** Check actual serialized request bytes, including model/safety rewrites and compatibility retries. */
export function assertRelayRequestBodyCapacity(body: Buffer, contentType: unknown): void {
  const multipart = String(contentType ?? "")
    .toLowerCase()
    .startsWith("multipart/form-data");
  const limitMb = multipart
    ? getAIResourceConfig().relay.resourceGuard.multipartBodyLimitMb
    : env.runtime.requestSizeLimits.jsonBodyLimitMb;
  if (body.length > limitMb * 1024 * 1024)
    throw new PayloadTooLargeError("Relay request body exceeds the input limit", undefined, {
      messageKey: "errors.payloadTooLargeLimit",
      messageParams: { limitMb },
    });
}

/** An upstream declared length is useful for early refusal; unknown lengths still need bounded reads. */
export function relayDeclaredBodyTooLarge(contentLength: unknown, limitBytes: number): boolean {
  const value = String(contentLength ?? "");
  return /^\d+$/.test(value) && Number(value) > limitBytes;
}

export function relayStreamFailureStatus(error: unknown): number {
  return error instanceof PayloadTooLargeError
    ? 413
    : error instanceof ContentSafetyBlockedError
      ? 403
      : error instanceof GatewayTimeoutError
        ? 504
        : 502;
}

/** Never implicitly start a 200 on failure. Already-open SSE ends with a bounded error, never DONE. */
export function endFailedRelayStream(res: RelayResponseLike, error: unknown, format: RelayRequestFormat): void {
  if (!res.headersSent || res.writableEnded) return;
  const code = relayStreamFailureStatus(error);
  const failure = {
    message: code === 413 ? "Response exceeds server capacity; this request was not charged" : "Upstream stream failed",
    type: code === 413 ? "request_too_large" : code === 403 ? "content_safety_blocked" : "upstream_error",
    code,
  };
  const payload =
    format === "openai-responses"
      ? { type: "response.failed", response: { status: "failed", error: failure } }
      : format === "anthropic"
        ? { type: "error", error: failure }
        : { error: failure };
  res.end(
    "event: " +
      (format === "openai-responses" ? "response.failed" : "error") +
      "\ndata: " +
      JSON.stringify(payload) +
      "\n\n",
  );
}
