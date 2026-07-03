const EXACT_HTTP_STATUS_RULE_REGEX = /^[1-5]\d{2}$/;
const WILDCARD_HTTP_STATUS_RULE_REGEX = /^[0-9x*]{3}$/i;
const REGEX_FLAGS_REGEX = /^[imsu]*$/;

export const MAX_RETRY_STATUS_RULES = 20;

const HTTP_STATUS_CODES = Array.from({ length: 500 }, (_, index) => index + 100);

const parseRegexLiteral = (rule: string): RegExp | null => {
  if (!rule.startsWith("/")) return null;

  const lastSlashIndex = rule.lastIndexOf("/");
  if (lastSlashIndex <= 0) return null;

  const pattern = rule.slice(1, lastSlashIndex);
  const flags = rule.slice(lastSlashIndex + 1);

  if (!pattern || !REGEX_FLAGS_REGEX.test(flags)) return null;

  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
};

const normalizeSingleRetryStatusRule = (value: unknown): string | null => {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return null;
    return String(value);
  }

  const normalized = String(value ?? "").trim();
  if (!normalized) return null;

  return parseRegexLiteral(normalized) ? normalized : normalized.toLowerCase();
};

const matchesWildcardHttpStatusRule = (statusCode: number, rule: string): boolean => {
  const statusText = String(statusCode);
  if (statusText.length !== 3 || rule.length !== 3) return false;

  return rule.split("").every((char, index) => {
    if (char === "x" || char === "*") return true;
    return statusText[index] === char;
  });
};

export const matchesRetryStatusRule = (statusCode: number, rawRule: unknown): boolean => {
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) return false;

  const rule = normalizeSingleRetryStatusRule(rawRule);
  if (!rule) return false;

  if (EXACT_HTTP_STATUS_RULE_REGEX.test(rule)) return Number(rule) === statusCode;

  if (WILDCARD_HTTP_STATUS_RULE_REGEX.test(rule) && /[x*]/i.test(rule))
    return matchesWildcardHttpStatusRule(statusCode, rule);

  const regex = parseRegexLiteral(rule);
  if (!regex) return false;

  regex.lastIndex = 0;
  return regex.test(String(statusCode));
};

export const isValidRetryStatusRule = (rawRule: unknown): boolean => {
  const rule = normalizeSingleRetryStatusRule(rawRule);
  if (!rule) return false;

  if (EXACT_HTTP_STATUS_RULE_REGEX.test(rule)) return true;

  if (WILDCARD_HTTP_STATUS_RULE_REGEX.test(rule) && /[x*]/i.test(rule))
    return HTTP_STATUS_CODES.some((statusCode) => matchesWildcardHttpStatusRule(statusCode, rule));

  const regex = parseRegexLiteral(rule);
  if (!regex) return false;

  return HTTP_STATUS_CODES.some((statusCode) => {
    regex.lastIndex = 0;
    return regex.test(String(statusCode));
  });
};

export const normalizeRetryStatusRules = (rules: unknown[] | null | undefined): string[] => {
  if (!Array.isArray(rules) || rules.length === 0) return [];

  const normalizedRules: string[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    const normalizedRule = normalizeSingleRetryStatusRule(rule);
    if (!normalizedRule || !isValidRetryStatusRule(normalizedRule) || seen.has(normalizedRule)) continue;

    seen.add(normalizedRule);
    normalizedRules.push(normalizedRule);
  }

  return normalizedRules;
};
