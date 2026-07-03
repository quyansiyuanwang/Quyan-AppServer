import type { ApiResponse } from "@/api/dto/common/common.dto";

/**
 * IP 黑名单基本信息
 */
export interface IPBlacklistDto {
  /** ID */
  id: string;

  /** IP 地址 */
  ipAddress: string;

  /** 过期时间 */
  expireTime: string;

  /** 封禁级别 */
  banLevel: number;

  /** 封禁原因 */
  banReason: string;

  /** 封禁操作者用户 ID */
  bannedBy?: string | null;

  /** 错误计数 */
  errorCount: number;

  /** 元数据 */
  metadata?: any;

  /** 状态 */
  status: number;

  /** 创建时间 */
  createTime: string;

  /** 更新时间 */
  updateTime: string;
}

/**
 * 创建 IP 黑名单请求
 */
export interface CreateIPBlacklistDto {
  /**
   * IP 地址（IPv4 或 IPv6）
   */
  ipAddress: string;

  /**
   * 封禁时长（秒），-1 表示永久封禁
   */
  duration: number;

  /**
   * 封禁原因
   */
  reason?: string;
}

/**
 * 更新 IP 黑名单请求
 */
export interface UpdateIPBlacklistDto {
  /**
   * 封禁原因（可选）
   */
  banReason?: string;

  /**
   * 过期时间（可选）
   */
  expireTime?: string;
}

/**
 * 检查 IP 是否被封禁响应
 */
export interface CheckIPBlacklistDto {
  /** 是否被封禁 */
  isBlacklisted: boolean;

  /** 黑名单信息（如果被封禁） */
  blacklistInfo?: IPBlacklistDto | null;
}

/**
 * 获取所有 IP 黑名单响应数据
 */
export interface GetAllIPBlacklistsData {
  blacklists: IPBlacklistDto[];
  total: number;
}

/**
 * 监控面板响应数据
 */
export interface MonitoringDashboardResponse {
  activeBans: {
    total: number;
    byLevel: { level1: number; level2: number; level3: number };
    byType: { auto: number; manual: number };
    recentBans: IPBlacklistDto[];
  };
  recentActivity: {
    last24Hours: number;
    last7Days: number;
    timeline: Array<{ date: string; count: number }>;
  };
  topBannedIPs: Array<{
    ipAddress: string;
    banCount: number;
    lastBanTime: string;
    currentStatus: "banned" | "unbanned";
  }>;
}

/**
 * IP 错误类型分布条目
 */
export interface IPErrorBreakdownItem {
  /** 字段 key，如 "s:400" 或 "c:1012" */
  key: string;
  /** 类型：status = HTTP状态码，custom = 自定义业务码 */
  type: "status" | "custom";
  /** 错误码字符串 */
  code: string;
  /** 累计权重贡献 */
  weight: number;
  /** 占总权重的百分比 */
  percentage: number;
  /** 错误描述（可选） */
  description?: string;
}

/**
 * IP 错误状态响应
 */
export interface IPErrorStatusResponse {
  ipAddress: string;
  errorWeight: number;
  currentLevel: number;
  thresholds: { level1: number; level2: number; level3: number };
  isBanned: boolean;
  decayConfig: { enabled: boolean; decayRate: number; minThreshold: number; interval: number };
  /** 错误类型分布（各类错误对权重的贡献） */
  errorBreakdown: IPErrorBreakdownItem[];
}

/**
 * 设置 IP 错误权重请求
 */
export interface SetIpErrorWeightRequest {
  weight: number;
}

/**
 * 响应类型定义
 */
export type GetAllIPBlacklistsResponse = GetAllIPBlacklistsData;
export type GetIPBlacklistByIdResponse = IPBlacklistDto;
export type CreateIPBlacklistResponse = IPBlacklistDto;
export type UpdateIPBlacklistResponse = IPBlacklistDto;
export type DeleteIPBlacklistResponse = { success: boolean };
export type CheckIPBlacklistResponse = CheckIPBlacklistDto;
