export const CCSWITCH_BALANCE_SAMPLE = `\
({
  request: {
    url: "{{usageEndpoint}}",
    method: "GET",
    headers: {
      "Authorization": "Bearer {{apiKey}}",
      "User-Agent": "cc-switch/1.0"
    }
  },
  extractor: function(response) {
    if (response.code !== 0) return { isValid: false };
    return {
      unit: '曲',
      ...response.data
    };
  }
})`

export type BalanceScriptMetricFormat =
  | 'off'
  | 'exact'
  | 'smart'
  | 'k'
  | 'm'
  | 'dateTime'
  | 'dateOnly'
  | 'iso'
  | 'relative'
  | 'text'
  | 'raw'

export type BalanceScriptRangeMode = 'lifetime' | 'customWindow' | 'dailyReset' | 'customRange'

export type BalanceScriptResetPeriod = 'day' | 'week' | 'month'

export type BalanceScriptFieldKey =
  | 'requestCount'
  | 'totalTokens'
  | 'requestTokens'
  | 'responseTokens'
  | 'cacheCreationTokens'
  | 'cacheReadTokens'
  | 'chargedAmount'
  | 'coveredAmount'
  | 'totalSpend'
  | 'usedQuota'
  | 'remainingQuota'
  | 'quotaLimit'
  | 'lastUsedAt'
  | 'rangeLabel'

export type BalanceScriptGraphMetric = 'off' | 'quotaUsage' | 'remainingQuota' | 'tokenRatio'

export type BalanceScriptTemplatePreset =
  | 'compact'
  | 'overview'
  | 'usage'
  | 'compare'
  | 'tokens'
  | 'quota'
  | 'cost'
  | 'quotaCost'
  | 'debug'
  | 'cache'
  | 'status'
  | 'finance'
  | 'tokenCost'
  | 'requestOnly'
  | 'graphSimple'
  | 'costWithCache'
  | 'minimal'
  | 'custom'

export type BalanceScriptHardcodedUsageEndpointSource = 'ai' | 'api' | 'off'

export const BALANCE_SCRIPT_FIELDS: BalanceScriptFieldKey[] = [
  'requestCount',
  'totalTokens',
  'requestTokens',
  'responseTokens',
  'cacheCreationTokens',
  'cacheReadTokens',
  'chargedAmount',
  'coveredAmount',
  'totalSpend',
  'usedQuota',
  'remainingQuota',
  'quotaLimit',
  'lastUsedAt',
  'rangeLabel',
]

export type BalanceScriptSettings = {
  extraLayout: 'inline' | 'multiline'
  extraTemplate: string
  templatePreset: BalanceScriptTemplatePreset
  decimalPlaces: number
  hardcodeUrlAndKey: boolean
  hardcodeKey: boolean
  hardcodedUsageEndpointSource: BalanceScriptHardcodedUsageEndpointSource
  timeRangeMode: BalanceScriptRangeMode
  windowHours: number
  customStartDate: string
  customEndDate: string
  resetAt: string
  resetPeriod: BalanceScriptResetPeriod
  resetEvery: number
  resetAnchorDate: string
  timezoneOffsetMinutes: number
  enabledFields: BalanceScriptFieldKey[]
  fieldFormats: Partial<Record<BalanceScriptFieldKey, BalanceScriptMetricFormat>>
  fieldDecimals: Partial<Record<BalanceScriptFieldKey, number>>
  unicodeGraph: {
    metric: BalanceScriptGraphMetric
  }
}

const RELAY_PROXY_SUFFIX = '/relay/proxy'
const PUBLIC_USAGE_ENDPOINT_PATH = '/v2/usage'
const VERSIONED_QUOTA_SUMMARY_PATH = '/v2/relay/tokens/current/quota-summary'
const V1_QUOTA_SUMMARY_PATH = '/v1/relay/tokens/current/quota-summary'

const normalizeUrl = (value?: string) => String(value || '').replace(/\/$/, '')

const normalizeRequestPath = (basePath: string, fallbackPath = PUBLIC_USAGE_ENDPOINT_PATH) => {
  const normalizedBasePath = String(basePath || '').replace(/\/$/, '')
  if (!normalizedBasePath) return fallbackPath

  if (/^\/relay\/proxy(?:\/|$)/i.test(normalizedBasePath)) {
    const base = normalizedBasePath.replace(/\/v\d+(?:\/.*)?$/i, '')
    return `${base}/v2/usage`
  }

  if (/^\/v\d+(?:\/|$)/i.test(normalizedBasePath)) {
    return fallbackPath
  }

  return normalizedBasePath.startsWith('/')
    ? normalizedBasePath
    : `/${normalizedBasePath.replace(/^\/+/, '')}`
}

export const resolveRelayPublicBaseUrl = (relayPublicBaseUrl?: string, aiProxyUrl?: string) => {
  const explicitPublicBaseUrl = normalizeUrl(relayPublicBaseUrl)
  if (explicitPublicBaseUrl) return explicitPublicBaseUrl

  const normalizedAiProxyUrl = normalizeUrl(aiProxyUrl)
  if (normalizedAiProxyUrl && !normalizedAiProxyUrl.includes(RELAY_PROXY_SUFFIX)) {
    return normalizedAiProxyUrl
  }

  return ''
}

export const resolveRelayAiBaseUrl = (relayPublicBaseUrl?: string, aiProxyUrl?: string) => {
  return resolveRelayPublicBaseUrl(relayPublicBaseUrl, aiProxyUrl) || normalizeUrl(aiProxyUrl)
}

export const buildRelayUsageEndpointUrl = (options: {
  relayPublicBaseUrl?: string
  aiProxyUrl?: string
  backendBaseUrl?: string
}) => {
  const publicBaseUrl = resolveRelayPublicBaseUrl(options.relayPublicBaseUrl, options.aiProxyUrl)
  if (publicBaseUrl) {
    if (/^https?:\/\//i.test(publicBaseUrl)) {
      try {
        const parsed = new URL(publicBaseUrl)
        const pathname = normalizeRequestPath(parsed.pathname, PUBLIC_USAGE_ENDPOINT_PATH)
        return `${parsed.origin}${pathname}${parsed.search}${parsed.hash}`
      } catch {
        return `${publicBaseUrl.replace(/\/+$/, '')}${PUBLIC_USAGE_ENDPOINT_PATH}`
      }
    }
    return normalizeRequestPath(publicBaseUrl, PUBLIC_USAGE_ENDPOINT_PATH)
  }

  return PUBLIC_USAGE_ENDPOINT_PATH
}

export const buildRelayApiUsageEndpointUrl = (backendBaseUrl?: string) => {
  const normalizedBackendBaseUrl = normalizeUrl(backendBaseUrl)
  if (normalizedBackendBaseUrl) {
    if (/^https?:\/\//i.test(normalizedBackendBaseUrl)) {
      try {
        const parsed = new URL(normalizedBackendBaseUrl)
        const pathname = normalizeRequestPath(parsed.pathname, VERSIONED_QUOTA_SUMMARY_PATH)
        return `${parsed.origin}${pathname}${parsed.search}${parsed.hash}`
      } catch {
        return `${normalizedBackendBaseUrl.replace(/\/+$/, '')}${VERSIONED_QUOTA_SUMMARY_PATH}`
      }
    }
    return normalizeRequestPath(normalizedBackendBaseUrl, VERSIONED_QUOTA_SUMMARY_PATH)
  }
  return VERSIONED_QUOTA_SUMMARY_PATH
}

export const buildRelayApiUsageEndpointUrlV1 = (backendBaseUrl?: string) => {
  const normalizedBackendBaseUrl = normalizeUrl(backendBaseUrl)
  return normalizedBackendBaseUrl
    ? `${normalizedBackendBaseUrl}${V1_QUOTA_SUMMARY_PATH}`
    : V1_QUOTA_SUMMARY_PATH
}

export const buildRelayAiUsageEndpointUrl = (options: {
  relayPublicBaseUrl?: string
  aiProxyUrl?: string
}) => {
  const aiBaseUrl = resolveRelayAiBaseUrl(options.relayPublicBaseUrl, options.aiProxyUrl)
  if (aiBaseUrl) {
    if (/^https?:\/\//i.test(aiBaseUrl)) {
      try {
        const parsed = new URL(aiBaseUrl)
        const pathname = normalizeRequestPath(parsed.pathname, PUBLIC_USAGE_ENDPOINT_PATH)
        return `${parsed.origin}${pathname}${parsed.search}${parsed.hash}`
      } catch {
        return `${aiBaseUrl.replace(/\/+$/, '')}${PUBLIC_USAGE_ENDPOINT_PATH}`
      }
    }
    return normalizeRequestPath(aiBaseUrl, PUBLIC_USAGE_ENDPOINT_PATH)
  }
  return PUBLIC_USAGE_ENDPOINT_PATH
}

export const BALANCE_SCRIPT_TEMPLATE_PRESETS: Record<BalanceScriptTemplatePreset, string> = {
  compact: '{req}r | {tok}t | {rem}/{lim}',
  overview: '{range} | {req}r | {tok}t | {spend}sp',
  usage: '{range} | {req}r/{allReq}ar | {tok}t/{allTok}at | {in}i | {out}o | {last}last',
  compare: 'now {tok}t/{req}r | all {allTok}at/{allReq}ar',
  tokens: 't {tok} = {in}i + {out}o | c+ {cacheCreate} / c= {cacheRead}',
  quota: '{graph} | u {used} | rem {remain} | lim {limit}',
  cost: 'ch {charged} | cv {covered} | sp {spend}',
  quotaCost: '{graph} | rem {remain}/{limit} | sp {spend} | ch {charged}',
  debug:
    '{range} | r {req} | t {tok} | i {in} | o {out} | c+ {cacheCreate} | c= {cacheRead} | ch {charged} | cv {covered} | sp {spend} | u {used} | rem {remain} | lim {limit} | {last}last',
  cache: 'c+ {cacheCreate} / c= {cacheRead} | t {tok} = {in}i + {out}o',
  status: '{graph} {rem}/{lim} · {req}r {tok}t',
  finance: 'ch {charged} | cv {covered} | sp {spend} | rem {remain}/{lim}',
  tokenCost: 't {tok} ({in}i+{out}o) | sp {spend} | {rem}/{lim}',
  requestOnly: '{range} | {req}r/{allReq}ar | {tok}t/{allTok}at',
  graphSimple: '{graph} {rem}/{lim}',
  costWithCache: '{range} | sp {spend} | c+ {cacheCreate} / c= {cacheRead}',
  minimal: '{req}r {tok}t',
  custom: '',
}

const getTodayLocalDateString = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getTodayLocalStartDateTimeString = () => `${getTodayLocalDateString()}T00:00:00`

export const DEFAULT_BALANCE_SCRIPT_SETTINGS: BalanceScriptSettings = {
  extraLayout: 'inline',
  extraTemplate: BALANCE_SCRIPT_TEMPLATE_PRESETS.compact,
  templatePreset: 'compact',
  decimalPlaces: 2,
  hardcodeUrlAndKey: false,
  hardcodeKey: false,
  hardcodedUsageEndpointSource: 'ai',
  timeRangeMode: 'lifetime',
  windowHours: 24,
  customStartDate: getTodayLocalStartDateTimeString(),
  customEndDate: '',
  resetAt: '00:00',
  resetPeriod: 'day',
  resetEvery: 1,
  resetAnchorDate: getTodayLocalDateString(),
  timezoneOffsetMinutes: 480,
  enabledFields: [...BALANCE_SCRIPT_FIELDS],
  fieldFormats: {
    requestCount: 'exact',
    totalTokens: 'smart',
    requestTokens: 'smart',
    responseTokens: 'smart',
    cacheCreationTokens: 'smart',
    cacheReadTokens: 'smart',
    chargedAmount: 'exact',
    coveredAmount: 'exact',
    totalSpend: 'exact',
    usedQuota: 'exact',
    remainingQuota: 'exact',
    quotaLimit: 'exact',
    lastUsedAt: 'dateTime',
    rangeLabel: 'text',
  },
  fieldDecimals: {},
  unicodeGraph: {
    metric: 'off',
  },
}

export const buildCcswitchBalanceScript = (
  usageEndpointUrl: string,
  apiKey: string,
  settings: BalanceScriptSettings,
) => {
  const safeSettings = {
    ...settings,
    extraTemplate: String(settings.extraTemplate || ''),
    decimalPlaces: Math.min(Math.max(Number(settings.decimalPlaces || 0), 0), 2),
  }
  const authorizationHeader = safeSettings.hardcodeKey ? `Bearer ${apiKey}` : 'Bearer {{apiKey}}'
  const queryParams = new URLSearchParams()

  const buildUsageUrl = (baseUrl: string) => {
    const normalizedBaseUrl = normalizeUrl(baseUrl)
    if (!normalizedBaseUrl) return PUBLIC_USAGE_ENDPOINT_PATH

    if (/^https?:\/\//i.test(normalizedBaseUrl)) {
      try {
        const parsedUrl = new URL(normalizedBaseUrl)
        const origin = parsedUrl.origin
        const pathname = normalizeRequestPath(parsedUrl.pathname, PUBLIC_USAGE_ENDPOINT_PATH)
        return `${origin}${pathname}${parsedUrl.search}${parsedUrl.hash}`
      } catch {
        return PUBLIC_USAGE_ENDPOINT_PATH
      }
    }

    return normalizeRequestPath(normalizedBaseUrl, PUBLIC_USAGE_ENDPOINT_PATH)
  }

  if (safeSettings.timeRangeMode === 'customWindow') {
    queryParams.set('windowHours', String(Math.max(0, Number(safeSettings.windowHours || 0))))
  } else if (safeSettings.timeRangeMode === 'customRange') {
    if (safeSettings.customStartDate) queryParams.set('startDate', safeSettings.customStartDate)
    if (safeSettings.customEndDate) queryParams.set('endDate', safeSettings.customEndDate)
  }

  const normalizedUsageEndpointUrl = buildUsageUrl(usageEndpointUrl)
  const baseUrlStr =
    safeSettings.hardcodedUsageEndpointSource !== 'off'
      ? normalizedUsageEndpointUrl
      : '{{baseUrl}}/v2/usage'

  const appendQueryString = (url: string, queryString: string) =>
    queryString ? `${url}${url.includes('?') ? '&' : '?'}${queryString}` : url

  const buildRequestUrlSnippet = (currentQueryString: string) => {
    const queryString = appendQueryString(baseUrlStr, currentQueryString)
    return JSON.stringify(queryString)
  }

  const requestUrlSnippet = buildRequestUrlSnippet(queryParams.toString())

  const extractorFn = `function(response) {
    if (response.code !== 0 || !response.data) {
      return {
        isValid: false,
        invalidMessage: response.message || "Request failed"
      };
    }

    const data = response.data;
    const scopedData = data.scopedSummary;
    const settings = ${JSON.stringify(safeSettings)};

    const allTimeData = data.allTimeSummary;

    function getQuotaValues(sourceData) {
      const sourceTotal = sourceData && typeof sourceData.quotaLimit === "number" ? sourceData.quotaLimit : undefined;
      const sourceUsed = sourceData && typeof sourceData.usedQuota === "number" ? sourceData.usedQuota : undefined;
      const sourceRemaining = sourceData && typeof sourceData.remainingQuota === "number"
        ? sourceData.remainingQuota
        : undefined;
      return {
        total: sourceTotal,
        used: sourceUsed,
        remaining: sourceRemaining
      };
    }

    const scopedQuota = getQuotaValues(scopedData);
    const allTimeQuota = getQuotaValues(allTimeData);
    const total = scopedQuota.total;
    const used = scopedQuota.used;
    const remaining = scopedQuota.remaining != null ? scopedQuota.remaining : (typeof data.balance === "number" ? data.balance : undefined);

    function trimZeros(value) {
      return String(value).replace(/\\.0+$|(\\.\\d*[1-9])0+$/, "$1");
    }

    function formatShort(value, divisor, suffix) {
      return trimZeros((Number(value) / divisor).toFixed(settings.decimalPlaces)) + suffix;
    }

    function formatExact(value, decimals) {
      var dp = typeof decimals === "number" ? decimals : 4;
      var fixed = Number(value).toFixed(dp);
      return trimZeros(fixed);
    }

    function formatMetric(value, mode, decimals) {
      const absValue = Math.abs(Number(value));
      if (mode === "k") return formatShort(value, 1000, "K");
      if (mode === "m") return formatShort(value, 1000000, "M");
      if (mode === "smart") {
        if (absValue >= 1000000) return formatShort(value, 1000000, "M");
        if (absValue >= 1000) return formatShort(value, 1000, "K");
      }
      return formatExact(value, decimals);
    }

    function formatDate(value, mode) {
      if (!value) return undefined;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return String(value);
      if (mode === "dateOnly") return parsed.toISOString().slice(0, 10);
      if (mode === "iso") return parsed.toISOString();
      if (mode === "relative") {
        const diffMs = Date.now() - parsed.getTime();
        const absMs = Math.abs(diffMs);
        const units = [
          [86400000, "d"],
          [3600000, "h"],
          [60000, "m"],
          [1000, "s"]
        ];
        for (const unit of units) {
          if (absMs >= unit[0]) {
            const amount = Math.floor(absMs / unit[0]);
            return diffMs >= 0 ? amount + unit[1] + " ago" : "in " + amount + unit[1];
          }
        }
        return "just now";
      }
      return parsed.toISOString().replace('T', ' ').replace(/\\.\\d{3}Z$/, 'Z');
    }

    function formatText(value) {
      if (value == null) return undefined;
      return String(value);
    }

    function getFieldFormat(fieldKey, fallbackMode) {
      const configuredFormat = settings.fieldFormats && settings.fieldFormats[fieldKey];
      return configuredFormat && configuredFormat !== "off" ? configuredFormat : fallbackMode;
    }

    function getFieldDecimals(fieldKey) {
      var d = settings.fieldDecimals && settings.fieldDecimals[fieldKey];
      return typeof d === "number" ? d : settings.decimalPlaces;
    }

    function makeBar(ratio) {
      const width = 10;
      const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
      const filled = Math.round(safeRatio * width);
      return "[" + "█".repeat(filled) + "░".repeat(Math.max(0, width - filled)) + "]";
    }

    const fieldLabels = {
      requestCount: "req",
      totalTokens: "tok",
      requestTokens: "in",
      responseTokens: "out",
      cacheCreationTokens: "cache+",
      cacheReadTokens: "cache=",
      chargedAmount: "charged",
      coveredAmount: "covered",
      totalSpend: "spend",
      usedQuota: "used",
      remainingQuota: "remain",
      quotaLimit: "limit",
      lastUsedAt: "last",
      rangeLabel: "range"
    };

    function createValueGetters(sourceData, quotaValues) {
      return {
        requestCount: function() { return sourceData && typeof sourceData.requestCount === "number" ? formatMetric(sourceData.requestCount, getFieldFormat("requestCount", "exact"), getFieldDecimals("requestCount")) : undefined; },
        totalTokens: function() { return sourceData && typeof sourceData.totalTokens === "number" ? formatMetric(sourceData.totalTokens, getFieldFormat("totalTokens", "smart"), getFieldDecimals("totalTokens")) : undefined; },
        requestTokens: function() { return sourceData && typeof sourceData.requestTokens === "number" ? formatMetric(sourceData.requestTokens, getFieldFormat("requestTokens", "smart"), getFieldDecimals("requestTokens")) : undefined; },
        responseTokens: function() { return sourceData && typeof sourceData.responseTokens === "number" ? formatMetric(sourceData.responseTokens, getFieldFormat("responseTokens", "smart"), getFieldDecimals("responseTokens")) : undefined; },
        cacheCreationTokens: function() { return sourceData && typeof sourceData.cacheCreationTokens === "number" ? formatMetric(sourceData.cacheCreationTokens, getFieldFormat("cacheCreationTokens", "smart"), getFieldDecimals("cacheCreationTokens")) : undefined; },
        cacheReadTokens: function() { return sourceData && typeof sourceData.cacheReadTokens === "number" ? formatMetric(sourceData.cacheReadTokens, getFieldFormat("cacheReadTokens", "smart"), getFieldDecimals("cacheReadTokens")) : undefined; },
        chargedAmount: function() { return sourceData && typeof sourceData.chargedAmount === "number" ? formatMetric(sourceData.chargedAmount, getFieldFormat("chargedAmount", "exact"), getFieldDecimals("chargedAmount")) : undefined; },
        coveredAmount: function() { return sourceData && typeof sourceData.coveredAmount === "number" ? formatMetric(sourceData.coveredAmount, getFieldFormat("coveredAmount", "exact"), getFieldDecimals("coveredAmount")) : undefined; },
        totalSpend: function() { return sourceData && typeof sourceData.totalSpend === "number" ? formatMetric(sourceData.totalSpend, getFieldFormat("totalSpend", "exact"), getFieldDecimals("totalSpend")) : undefined; },
        usedQuota: function() { return sourceData && typeof sourceData.usedQuota === "number" ? formatMetric(sourceData.usedQuota, getFieldFormat("usedQuota", "exact"), getFieldDecimals("usedQuota")) : undefined; },
        remainingQuota: function() { return typeof quotaValues.remaining === "number" ? formatMetric(quotaValues.remaining, getFieldFormat("remainingQuota", "exact"), getFieldDecimals("remainingQuota")) : undefined; },
        quotaLimit: function() { return typeof quotaValues.total === "number" ? formatMetric(quotaValues.total, getFieldFormat("quotaLimit", "exact"), getFieldDecimals("quotaLimit")) : undefined; },
        lastUsedAt: function() { return sourceData ? formatDate(sourceData.lastUsedAt, getFieldFormat("lastUsedAt", "dateTime")) : undefined; },
        rangeLabel: function() { return sourceData ? formatText(sourceData.rangeLabel || (sourceData.rangeStartAt && sourceData.rangeEndAt ? formatDate(sourceData.rangeStartAt, "dateTime") + " ~ " + formatDate(sourceData.rangeEndAt, "dateTime") : undefined)) : undefined; }
      };
    }

    function collectFieldValues(valueGetters) {
      const collectedFieldValues = {};
      const collectedExtraParts = [];
      for (const fieldKey of ${JSON.stringify(BALANCE_SCRIPT_FIELDS)}) {
        const getter = valueGetters[fieldKey];
        if (typeof getter !== "function") continue;
        const value = getter();
        if (value == null || value === "") continue;
        collectedFieldValues[fieldKey] = value;
        if (settings.fieldFormats && settings.fieldFormats[fieldKey] === "off") continue;
        collectedExtraParts.push(fieldLabels[fieldKey] + ": " + value);
      }
      return {
        fieldValues: collectedFieldValues,
        extraParts: collectedExtraParts
      };
    }

    const scopedFields = collectFieldValues(createValueGetters(scopedData, scopedQuota));
    const allTimeFields = allTimeData
      ? collectFieldValues(createValueGetters(allTimeData, allTimeQuota))
      : { fieldValues: {}, extraParts: [] };
    const fieldValues = scopedFields.fieldValues;
    const allTimeFieldValues = allTimeFields.fieldValues;
    const extraParts = scopedFields.extraParts;

    let graphText;
    if (settings.unicodeGraph && settings.unicodeGraph.metric !== "off") {
      if (settings.unicodeGraph.metric === "quotaUsage" && typeof used === "number" && typeof total === "number" && total > 0) {
        graphText = "u " + makeBar(used / total) + " " + trimZeros(((used / total) * 100).toFixed(1)) + "%";
      } else if (settings.unicodeGraph.metric === "remainingQuota" && typeof remaining === "number" && typeof total === "number" && total > 0) {
        graphText = "rem " + makeBar(remaining / total) + " " + trimZeros(((remaining / total) * 100).toFixed(1)) + "%";
      } else if (settings.unicodeGraph.metric === "tokenRatio" && typeof scopedData.requestTokens === "number" && typeof scopedData.responseTokens === "number") {
        const tokenTotal = scopedData.requestTokens + scopedData.responseTokens;
        if (tokenTotal > 0) graphText = "in/out " + makeBar(scopedData.requestTokens / tokenTotal) + " " + trimZeros(((scopedData.requestTokens / tokenTotal) * 100).toFixed(1)) + "%";
      }
    }

    const placeholders = {
      req: fieldValues.requestCount,
      tok: fieldValues.totalTokens,
      in: fieldValues.requestTokens,
      out: fieldValues.responseTokens,
      cacheCreate: fieldValues.cacheCreationTokens,
      cacheRead: fieldValues.cacheReadTokens,
      charged: fieldValues.chargedAmount,
      covered: fieldValues.coveredAmount,
      spend: fieldValues.totalSpend,
      used: fieldValues.usedQuota,
      remain: fieldValues.remainingQuota,
      limit: fieldValues.quotaLimit,
      last: fieldValues.lastUsedAt,
      range: fieldValues.rangeLabel,
      graph: graphText,
      allReq: allTimeFieldValues.requestCount,
      allTok: allTimeFieldValues.totalTokens,
      allIn: allTimeFieldValues.requestTokens,
      allOut: allTimeFieldValues.responseTokens,
      allCacheCreate: allTimeFieldValues.cacheCreationTokens,
      allCacheRead: allTimeFieldValues.cacheReadTokens,
      allCharged: allTimeFieldValues.chargedAmount,
      allCovered: allTimeFieldValues.coveredAmount,
      allSpend: allTimeFieldValues.totalSpend,
      allUsed: allTimeFieldValues.usedQuota,
      allRemain: allTimeFieldValues.remainingQuota,
      allLimit: allTimeFieldValues.quotaLimit,
      allLast: allTimeFieldValues.lastUsedAt
    };

    function renderTemplate(template) {
      const rendered = String(template || "").replace(/\\{([a-zA-Z][a-zA-Z0-9]*)\\}/g, function(match, key) {
        const value = placeholders[key];
        return value == null ? "" : String(value);
      });
      return rendered
        .replace(/[ \\t]+\\n/g, "\\n")
        .trim()
        .split("|")
        .map(function(s) { return s.trim(); })
        .filter(Boolean)
        .join(" | ");
    }

    const templateExtra = settings.extraTemplate ? renderTemplate(settings.extraTemplate) : "";

    return {
      isValid: data.status === 1,
      invalidMessage: data.status === 1 ? undefined : "Relay token is disabled",
      remaining,
      unit: "曲",
      planName: scopedData.tokenName,
      total,
      used,
      extra: templateExtra || (extraParts.length
        ? extraParts.join(settings.extraLayout === "multiline" ? "\\n" : " | ")
        : undefined)
    };
  }`

  if (safeSettings.timeRangeMode === 'dailyReset') {
    const resetSettings = {
      resetAt: /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(safeSettings.resetAt || ''))
        ? String(safeSettings.resetAt)
        : DEFAULT_BALANCE_SCRIPT_SETTINGS.resetAt,
      tzOffsetMinutes: Math.round(Number(safeSettings.timezoneOffsetMinutes || 0)),
      resetPeriod: safeSettings.resetPeriod || 'day',
      resetEvery: Math.max(1, safeSettings.resetEvery || 1),
      resetAnchorDate: safeSettings.resetAnchorDate || getTodayLocalDateString(),
    }

    const computePeriodStartFn = `function computePeriodStart(s) {
  var now = Date.now();
  var tzMs = (s.tzOffsetMinutes || 0) * 60000;
  var rp = s.resetAt.split(":");
  var resetTimeMs = (parseInt(rp[0]) * 60 + parseInt(rp[1])) * 60000;
  var ap = (s.resetAnchorDate || "2000-01-01").split("-");
  var anchorUtc = Date.UTC(+ap[0], +ap[1] - 1, +ap[2]) + resetTimeMs - tzMs;
  if (s.resetPeriod === "month") {
    var nowLocal = new Date(now + tzMs);
    var y = nowLocal.getUTCFullYear(), m = nowLocal.getUTCMonth(), anchorDay = +ap[2];
    for (var i = 0; i < 25; i++) {
      var endOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      var day = Math.min(anchorDay, endOfMonth);
      var candidate = Date.UTC(y, m, day) + resetTimeMs - tzMs;
      if (candidate <= now) {
        var diff = (y - +ap[0]) * 12 + (m - (+ap[1] - 1));
        if (diff >= 0 && diff % (s.resetEvery || 1) === 0) return new Date(candidate).toISOString();
      }
      if (--m < 0) { m = 11; y--; }
    }
    return new Date(anchorUtc).toISOString();
  }
  var periodMs = (s.resetPeriod === "week" ? 7 : 1) * (s.resetEvery || 1) * 86400000;
  var elapsed = now - anchorUtc;
  return new Date(anchorUtc + (elapsed < 0 ? 0 : Math.floor(elapsed / periodMs)) * periodMs).toISOString();
}`

    return `(function() {
${computePeriodStartFn}
  var rs = ${JSON.stringify(resetSettings)};
  var startDate = computePeriodStart(rs);
  var endDate = new Date().toISOString();
  return {
    request: {
      url: ${JSON.stringify(baseUrlStr)} + "?" + "startDate=" + encodeURIComponent(startDate) + "&" + "endDate=" + encodeURIComponent(endDate),
      method: "GET",
      headers: {
        "Authorization": ${JSON.stringify(authorizationHeader)},
        "User-Agent": "cc-switch/1.0"
      }
    },
    extractor: ${extractorFn}
  };
})()`
  }

  return `({
  request: {
    url: ${requestUrlSnippet},
    method: "GET",
    headers: {
      "Authorization": ${JSON.stringify(authorizationHeader)},
      "User-Agent": "cc-switch/1.0"
    }
  },
  extractor: ${extractorFn}
})`
}

/** v1 旧版设置类型 — 用于 v1 弃用对话框 */
export type BalanceScriptV1Settings = {
  extraLayout: 'inline' | 'multiline'
  decimalPlaces: number
  hardcodeUrlAndKey: boolean
  hardcodeKey: boolean
  requestCount: {
    enabled: boolean
    format: BalanceScriptMetricFormat
  }
  totalTokens: {
    enabled: boolean
    format: BalanceScriptMetricFormat
  }
}

export const DEFAULT_V1_BALANCE_SCRIPT_SETTINGS: BalanceScriptV1Settings = {
  extraLayout: 'inline',
  decimalPlaces: 1,
  hardcodeUrlAndKey: false,
  hardcodeKey: false,
  requestCount: {
    enabled: true,
    format: 'exact',
  },
  totalTokens: {
    enabled: true,
    format: 'smart',
  },
}

/** v1 余额查询脚本 — 支持旧版配置项 */
export const buildV1CcswitchBalanceScript = (
  apiKey: string,
  settings?: BalanceScriptV1Settings,
) => {
  const usageEndpointUrl = buildRelayApiUsageEndpointUrlV1()
  const safeSettings = {
    ...DEFAULT_V1_BALANCE_SCRIPT_SETTINGS,
    ...(settings || {}),
    decimalPlaces: Math.min(
      Math.max(
        Number((settings?.decimalPlaces ?? DEFAULT_V1_BALANCE_SCRIPT_SETTINGS.decimalPlaces) || 0),
        0,
      ),
      2,
    ),
  }
  const requestUrl = safeSettings.hardcodeUrlAndKey ? usageEndpointUrl : usageEndpointUrl
  const requestUrlSnippet = JSON.stringify(requestUrl)
  const authorizationHeader = safeSettings.hardcodeKey ? `Bearer ${apiKey}` : 'Bearer {{apiKey}}'

  const extractorFn = `function(response) {
    if (response.code !== 0 || !response.data) {
      return {
        isValid: false,
        invalidMessage: response.message || "Request failed"
      };
    }

    const data = response.data;
    const total = typeof data.quotaLimit === "number" ? data.quotaLimit : undefined;
    const used = typeof data.usedQuota === "number" ? data.usedQuota : (data.chargedAmount || 0) + (data.coveredAmount || 0);
    const remaining = typeof data.remainingQuota === "number" ? data.remainingQuota : undefined;
    const settings = ${JSON.stringify(safeSettings)};

    function trimZeros(value) {
      return String(value).replace(/\\.0+$|(\\.\\d*[1-9])0+$/, "$1");
    }

    function formatShort(value, divisor, suffix) {
      return trimZeros((Number(value) / divisor).toFixed(settings.decimalPlaces)) + suffix;
    }

    function formatExact(value) {
      return Number(value).toLocaleString("en-US", {
        maximumFractionDigits: 0
      });
    }

    function formatMetric(value, mode) {
      const absValue = Math.abs(Number(value));
      if (mode === "k") return formatShort(value, 1000, "K");
      if (mode === "m") return formatShort(value, 1000000, "M");
      if (mode === "smart") {
        if (absValue >= 1000000) return formatShort(value, 1000000, "M");
        if (absValue >= 1000) return formatShort(value, 1000, "K");
      }
      return formatExact(value);
    }

    const extraParts = [];
    if (settings.requestCount.enabled && typeof data.requestCount === "number") {
      extraParts.push("req: " + formatMetric(data.requestCount, settings.requestCount.format));
    }
    if (settings.totalTokens.enabled && typeof data.totalTokens === "number") {
      extraParts.push("tok: " + formatMetric(data.totalTokens, settings.totalTokens.format));
    }

    return {
      isValid: data.status === 1,
      invalidMessage: data.status === 1 ? undefined : "Relay token is disabled",
      remaining: remaining,
      unit: "曲",
      planName: data.tokenName,
      total: total,
      used: used,
      extra: extraParts.length
        ? extraParts.join(settings.extraLayout === "multiline" ? "\\\\n" : " | ")
        : undefined
    };
  }`

  return `({
  request: {
    url: ${requestUrlSnippet},
    method: "GET",
    headers: {
      "Authorization": "${authorizationHeader}",
      "User-Agent": "cc-switch/1.0"
    }
  },
  extractor: ${extractorFn}
})`
}
