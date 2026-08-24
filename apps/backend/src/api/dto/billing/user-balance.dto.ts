export interface UserBalanceResponse {
  isValid: boolean;
  invalidMessage?: string;
  remaining: number;
  unit?: string;
  planName?: string;
  total?: number;
  used?: number;
  extra?: string;
}
