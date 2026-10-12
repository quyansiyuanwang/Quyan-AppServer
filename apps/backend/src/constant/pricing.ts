import { ALL_RELAY_REQUEST_FORMATS } from "@quyan/shared";
// Token prices are stored/configured as price per million tokens.
export const TOKEN_PRICE_DIVISOR = 1_000_000;

export const DEFAULT_CACHE_CREATION_MULTIPLIER = 1.25;
export const DEFAULT_CACHE_READ_MULTIPLIER = 0.1;

export const DEFAULT_MODEL_PRICING_SUPPORTED_FORMATS = ALL_RELAY_REQUEST_FORMATS.join(",");

export const MODEL_PRICING_IMPORT_TRANSACTION_TIMEOUT_MS = 30_000;
