// IP to physical-location mappings normally change slowly. One day keeps the
// cache useful without making address changes linger for an excessive period.
export const GEO_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const GEO_CACHE_PREFIX = "ip:geo:";
export const BAIDU_GEO_API = "https://api.map.baidu.com/location/ip";
export const REQUEST_TIMEOUT_MS = 5000;
