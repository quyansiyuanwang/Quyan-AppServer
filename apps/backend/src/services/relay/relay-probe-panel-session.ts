import { CookieJar, type Cookie, type SerializedCookieJar } from "tough-cookie";
import type {
  RelayChannelProbeLoginDto,
  RelayChannelProbeWorkflowStepDto,
  RelayProbeAccountExpiryMode,
  RelayProbeAccountSessionFieldDto,
} from "@/api/dto/relay/relay-channel-probe.dto";
import { readProbeJsonPath } from "./probe-workflow.util";
import { BadRequestError } from "@/util/errors";

export interface ProbePanelSession {
  token: string;
  expiresAt: number;
  refreshUntil?: number;
  values?: Record<string, string>;
  cookieFields?: Record<string, string>;
  tokenCookieName?: string;
  cookies?: SerializedCookieJar;
  origins?: string[];
  revision?: string;
}
export interface ProbePanelSessionConfiguration {
  variables: Record<string, string>;
  workflow: RelayChannelProbeLoginDto;
  sessionFields?: RelayProbeAccountSessionFieldDto[];
  tokenField?: string;
  refreshWorkflow?: RelayChannelProbeLoginDto;
  refreshTtlSeconds?: number;
  sessionAllowedOrigins?: string[];
}
const invalid = () =>
  new BadRequestError("Panel session extraction failed", undefined, {
    messageKey: "relayChannelProbe.accountSessionInvalid",
  });

export function probePanelExpiry(
  value: unknown,
  mode: RelayProbeAccountExpiryMode | null,
  fallbackSeconds: number,
  now = Date.now(),
): number {
  if (value == null) return now + fallbackSeconds * 1000;
  const expiry =
    mode === "seconds"
      ? now + Number(value) * 1000
      : mode === "unixSeconds"
        ? Number(value) * 1000
        : mode === "unixMillis"
          ? Number(value)
          : Date.parse(String(value));
  if (!Number.isFinite(expiry)) throw invalid();
  return expiry;
}

export async function extractProbePanelFields(
  configuration: ProbePanelSessionConfiguration,
  data: unknown,
  headers: Record<string, unknown>,
  url: string,
  previous?: ProbePanelSession,
) {
  const jar = previous?.cookies
    ? CookieJar.deserializeSync(previous.cookies)
    : new CookieJar(undefined, { prefixSecurity: "strict", allowSecureOnLocal: false });
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const setCookie = normalizedHeaders["set-cookie"];
  const responseCookies: Cookie[] = [];
  for (const cookie of Array.isArray(setCookie) ? setCookie : typeof setCookie === "string" ? [setCookie] : []) {
    if (typeof cookie !== "string") throw invalid();
    try {
      const saved = await jar.setCookie(cookie, url);
      if (saved && saved.TTL() > 0) responseCookies.push(saved);
    } catch {
      throw invalid();
    }
  }
  const cookies = await jar.getCookies(url);
  const values = { ...previous?.values };
  const cookieFields = { ...previous?.cookieFields };
  for (const field of configuration.sessionFields ?? []) {
    const value =
      field.source === "json"
        ? readProbeJsonPath(data, field.selector)
        : field.source === "header"
          ? normalizedHeaders[field.selector.toLowerCase()]
          : (
              responseCookies.find((cookie) => cookie.key === field.selector) ??
              cookies.find((cookie) => cookie.key === field.selector)
            )?.cookieString();
    if (value === undefined || value === null || value === "") {
      if (field.name === configuration.tokenField || (field.required && !values[field.name])) throw invalid();
      continue;
    }
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      String(value).length > 8000 ||
      /[\r\n]/.test(String(value))
    )
      throw invalid();
    values[field.name] = String(value);
    if (field.source === "cookie") cookieFields[field.name] = field.selector;
  }
  return { values, cookieFields, cookies: jar.serializeSync() };
}

/** Named session values are panel-only. Cookie variables additionally obey domain/path/secure/expiry. */
export async function probePanelRequestVariables(
  session: ProbePanelSession,
  workflow: RelayChannelProbeLoginDto | RelayChannelProbeWorkflowStepDto,
  url: string,
): Promise<Record<string, string>> {
  const required = new Set<string>();
  for (const match of JSON.stringify(workflow).matchAll(/\{\{(accountToken|account\.[A-Za-z][A-Za-z0-9_]*)\}\}/g))
    required.add(match[1]!);
  if (required.size && session.origins && !session.origins.includes(new URL(url).origin)) throw invalid();
  const result = Object.fromEntries(
    Object.entries(session.values ?? {}).map(([name, value]) => [`account.${name}`, value]),
  );
  result.accountToken = session.token;
  if (session.cookies) {
    const cookies = await CookieJar.deserializeSync(session.cookies).getCookies(url);
    if (session.tokenCookieName) {
      const cookie = cookies.find((item) => item.key === session.tokenCookieName);
      if (cookie) result.accountToken = cookie.cookieString();
      else if (required.has("accountToken")) throw invalid();
    }
    for (const [name, cookieName] of Object.entries(session.cookieFields ?? {})) {
      const key = `account.${name}`;
      const cookie = cookies.find((item) => item.key === cookieName);
      if (cookie) result[key] = cookie.cookieString();
      else {
        delete result[key];
        if (required.has(key)) throw invalid();
      }
    }
  }
  return result;
}
