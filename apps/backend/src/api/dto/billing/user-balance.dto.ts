export interface UserBalanceResponse {
  isValid: boolean;
  invalidMessage?: string;
  remaining: number;
  unit?: string;
  planName?: string;
  total?: number;
  used?: number;
  /** Cache read tokens divided by all prompt tokens (input + cache reads). */
  cacheHitRate?: number;
  extra?: string;
}
