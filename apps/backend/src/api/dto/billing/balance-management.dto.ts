import type { BalanceOverdraftCategory, BalanceOverdraftRule } from "@quyan/shared";
export interface BalanceOverdraftDefaultDto {
  rule: BalanceOverdraftRule;
  categories: BalanceOverdraftCategory[];
  version: number;
}
export interface ManagedBalanceAccountDto {
  userId: string;
  username: string;
  balance: number;
  totalRecharged: number;
  totalUsed: number;
  updateTime: Date | null;
  rule: BalanceOverdraftRule;
  categories: BalanceOverdraftCategory[];
  ruleInherited: boolean;
  categoriesInherited: boolean;
  version: number;
  defaultVersion: number;
  overdraftLimit: number;
  usedOverdraft: number;
  remainingOverdraft: number;
  calculationError: boolean;
}
export interface ManagedBalanceListDto {
  records: ManagedBalanceAccountDto[];
  total: number;
  page: number;
  pageSize: number;
}
export type SetDefaultOverdraftRequest = BalanceOverdraftDefaultDto;
export interface SetUserOverdraftRequest {
  targets: { userId: string; version: number }[];
  defaultVersion: number;
  rule?: BalanceOverdraftRule | null;
  categories?: BalanceOverdraftCategory[] | null;
}
export interface PreviewOverdraftRequest {
  /** 按用户名精确选择目标，与 userIds 二选一。 */
  usernames?: string[];
  /** 兼容原有客户端；管理页面使用 usernames。 */
  userIds?: string[];
  rule?: BalanceOverdraftRule | null;
  categories?: BalanceOverdraftCategory[] | null;
}
export interface BalanceAdjustmentField {
  mode: "delta" | "set";
  value: number;
  expected?: number;
}
export interface AdjustBalanceAccountRequest {
  userId: string;
  operationId: string;
  reason: string;
  balance?: BalanceAdjustmentField;
  totalRecharged?: BalanceAdjustmentField;
  totalUsed?: BalanceAdjustmentField;
}
export interface BalanceAdjustmentResultDto {
  operationId: string;
  userId: string;
  before: { balance: number; totalRecharged: number; totalUsed: number };
  after: { balance: number; totalRecharged: number; totalUsed: number };
}
export interface BalanceAdjustmentPreviewDto {
  before: ManagedBalanceAccountDto;
  after: ManagedBalanceAccountDto;
}
