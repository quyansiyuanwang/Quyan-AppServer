/**
 * Relay token stream configuration for controlling streaming behavior
 */
export interface RelayTokenStreamConfig {
  /**
   * Preflight buffer limit in bytes before marking stream as failed if no visible output appears.
   * Default: 2MB (2 * 1024 * 1024)
   * Min: 256KB, Max: 10MB
   */
  preflightBufferLimitBytes?: number;
}

/**
 * Default preflight buffer limit (2MB)
 */
export const DEFAULT_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Minimum preflight buffer limit (256KB)
 */
export const MIN_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES = 256 * 1024;

/**
 * Maximum preflight buffer limit (10MB)
 */
export const MAX_STREAM_PREFLIGHT_BUFFER_LIMIT_BYTES = 10 * 1024 * 1024;
