import { resourceInteger } from "./ai-resources";
import { sanitizeInt } from "./common";
import type { EnvSnapshot } from "./source";

export function buildRequestSizeLimitsConfig(source: EnvSnapshot) {
  return {
    jsonBodyLimitMb: resourceInteger(source, "REQUEST_JSON_BODY_LIMIT_MB", 5, 1, 100),
    urlencodedBodyLimitMb: sanitizeInt(source.REQUEST_URLENCODED_BODY_LIMIT_MB, 2, 1, 100),
    otherBodyLimitMb: sanitizeInt(source.REQUEST_OTHER_BODY_LIMIT_MB, 10, 1, 100),
    archiveImportBodyLimitMb: sanitizeInt(source.DATA_MAINTENANCE_IMPORT_MAX_MB, 100, 1, 512),
  };
}
