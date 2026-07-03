import type { Request } from "express";
import { extractClientIp } from "@/util/ip-extractor";

export interface BusinessLogRequestContext {
  ipAddress: string;
  userAgent?: string;
  requestId: string;
}

function toHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function buildBusinessLogRequestContext(request?: Request): BusinessLogRequestContext {
  if (!request) return { ipAddress: "unknown", requestId: "unknown" };

  const requestId = toHeaderString(request.headers["x-request-id"]);

  return {
    ipAddress: extractClientIp(request),
    userAgent: toHeaderString(request.headers["user-agent"]),
    requestId: requestId ?? "unknown",
  };
}
