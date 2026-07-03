type CorsOriginMatcher = (origin: URL) => boolean;

function parseOriginUrl(rawOrigin: string): URL | null {
  try {
    const parsed = new URL(rawOrigin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeOrigin(rawOrigin: string): string | null {
  const parsed = parseOriginUrl(rawOrigin);
  if (!parsed) return null;
  return parsed.origin;
}

function createExactMatcher(entry: string): CorsOriginMatcher | null {
  const normalized = normalizeOrigin(entry);
  if (!normalized) return null;
  return (origin) => origin.origin === normalized;
}

function createWildcardMatcher(entry: string): CorsOriginMatcher | null {
  const match = entry.match(/^(https?):\/\/\*\.([^/:?#]+)(?::(\d+))?\/?$/i);
  if (!match) return null;

  const [, protocolName, baseHostRaw, port] = match;
  const protocol = `${protocolName.toLowerCase()}:`;
  const baseHost = baseHostRaw.toLowerCase();

  const validationUrl = parseOriginUrl(`${protocol}//placeholder.${baseHost}${port ? `:${port}` : ""}`);
  if (!validationUrl) return null;

  return (origin) => {
    if (origin.protocol !== protocol) return false;
    if ((origin.port || "") !== (port || "")) return false;

    const hostname = origin.hostname.toLowerCase();
    return hostname.length > baseHost.length && hostname.endsWith(`.${baseHost}`);
  };
}

function createRegexMatcher(entry: string): CorsOriginMatcher | null {
  const regexBody = entry.startsWith("regex:") ? entry.slice("regex:".length).trim() : "";
  if (!regexBody) return null;

  try {
    const regex = new RegExp(regexBody);
    return (origin) => regex.test(origin.origin);
  } catch {
    return null;
  }
}

function createMatcher(entry: string): CorsOriginMatcher | null {
  if (!entry) return null;
  if (entry.startsWith("regex:")) return createRegexMatcher(entry);
  if (entry.includes("*")) return createWildcardMatcher(entry);
  return createExactMatcher(entry);
}

export function createCorsOriginAllowlist(rawAllowlist: string): CorsOriginMatcher[] {
  return rawAllowlist
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => createMatcher(entry))
    .filter((matcher): matcher is CorsOriginMatcher => Boolean(matcher));
}

export function isCorsOriginAllowed(origin: string, matchers: CorsOriginMatcher[]): boolean {
  const parsedOrigin = parseOriginUrl(origin);
  if (!parsedOrigin) return false;
  return matchers.some((matcher) => matcher(parsedOrigin));
}
