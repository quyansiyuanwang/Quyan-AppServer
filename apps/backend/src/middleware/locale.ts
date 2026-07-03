import type { NextFunction, Request, Response } from "express";
import { DEFAULT_BACKEND_LOCALE, LOCALE_HEADER_NAME, normalizeBackendLocale, type BackendLocale } from "@/locales";

function getHeaderValue(request: Request, headerName: string): string | undefined {
  const value = request.headers[headerName];
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

export function resolveRequestLocale(request: Request): BackendLocale {
  const headerLocale = getHeaderValue(request, LOCALE_HEADER_NAME);
  return normalizeBackendLocale(headerLocale ?? DEFAULT_BACKEND_LOCALE);
}

export function localeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const locale = resolveRequestLocale(req);
  req.locale = locale;
  res.locals.locale = locale;
  res.setHeader(LOCALE_HEADER_NAME, locale);
  next();
}
