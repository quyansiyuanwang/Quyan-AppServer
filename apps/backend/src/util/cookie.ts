import type { Request } from "express";

function getCookieHeader(req: Request): string {
  const rawCookie = req.headers.cookie;
  if (Array.isArray(rawCookie)) return rawCookie.join("; ");
  return rawCookie || "";
}

export function getCookieValue(req: Request, cookieName: string): string | undefined {
  const normalizedCookieName = cookieName.trim();
  if (!normalizedCookieName) return undefined;

  const cookieHeader = getCookieHeader(req);
  if (!cookieHeader) return undefined;

  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;

    const key = pair.slice(0, index).trim();
    if (key !== normalizedCookieName) continue;

    const rawValue = pair.slice(index + 1).trim();
    if (!rawValue) return undefined;

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return undefined;
}
