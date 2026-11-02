import type { RelayProbeRoundTargetReportDto } from "@/api/dto/relay/relay-probe-round.dto";

/** Only closed, non-secret diagnostic codes may leave the worker. */
export function probeRoundFailure(state: string, message: string | null): { errorStage?: string; errorCode?: string } {
  if (state === "succeeded") return {};
  const text = message ?? "";
  const errorStage = /登录|login|session|refresh/i.test(text)
    ? "panel-session"
    : /余额|balance/i.test(text)
      ? "balance"
      : /校准|calibrat|pricing/i.test(text)
        ? "calibration"
        : /模型|model|请求|request/i.test(text)
          ? "model-request"
          : /authoriz|permission/i.test(text)
            ? "authorization"
            : "execution";
  const status = text.match(/(?:HTTP|status(?: code)?)[ :：]*(\d{3})/i)?.[1];
  const errorCode = status
    ? `upstream-http-${status}`
    : /authoriz|permission/i.test(text)
      ? "authorization-unavailable"
      : /变量|VARIABLE_MISSING/.test(text)
        ? "missing-variable"
        : /timeout|timed.out|超时/i.test(text) || state === "timed_out"
          ? "request-timeout"
          : /SSRF|private|outbound|blocked|禁止/i.test(text)
            ? "outbound-blocked"
            : /calibrat|校准|pricing/i.test(text)
              ? "calibration-failed"
              : state === "cancelled"
                ? "cancelled"
                : "probe-failed";
  return { errorStage, errorCode };
}

export function probeRoundChanges(
  measured: number | undefined,
  suggested: number | undefined,
  previous: number | undefined,
) {
  return {
    multiplierChange: measured !== undefined && suggested !== undefined ? suggested - measured : undefined,
    multiplierChangePercent:
      measured !== undefined && measured !== 0 && suggested !== undefined
        ? ((suggested - measured) / Math.abs(measured)) * 100
        : undefined,
    suggestionChange: previous !== undefined && suggested !== undefined ? suggested - previous : undefined,
    suggestionChangePercent:
      previous !== undefined && previous !== 0 && suggested !== undefined
        ? ((suggested - previous) / Math.abs(previous)) * 100
        : undefined,
  } satisfies Partial<RelayProbeRoundTargetReportDto>;
}
