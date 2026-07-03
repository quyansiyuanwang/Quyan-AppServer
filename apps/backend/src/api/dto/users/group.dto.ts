import type { ApiResponse as _ApiResponse } from "@/api/dto/common/common.dto";

/**
 * 用户组基本信息
 */
export interface GroupDto {
  /** 组ID */
  id: string;

  /**
   * 组标识
   */
  username: string;

  /** 显示名称 */
  name?: string | null;

  /** 权限列表 */
  permissions: string[];

  /** 组级别 */
  level: number;

  /** 描述 */
  description?: string | null;

  /** 组内用户数 */
  userCount?: number;

  /** 创建时间 */
  createdAt?: string;

  /** 更新时间 */
  updatedAt?: string;
}

/**
 * 创建用户组请求
 */
export interface CreateGroupDto {
  /**
   * 组标识
   */
  username: string;

  /**
   * 显示名称
   */
  name?: string;

  /**
   * 组级别
   */
  level: number;

  /**
   * 描述
   */
  description?: string;
}

/**
 * 更新用户组请求
 */
export interface UpdateGroupDto {
  /**
   * 显示名称
   */
  name?: string;

  /**
   * 组级别
   */
  level?: number;

  /**
   * 描述
   */
  description?: string;
}

/**
 * 设置组权限请求
 */
export interface SetGroupPermissionsDto {
  /** 权限列表 */
  permissions: string[];
}

/**
 * 分页获取用户组列表数据
 */
export interface GetAllGroupsData {
  groups: GroupDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// API 响应类型
export type GetAllGroupsResponse = GetAllGroupsData;
export type GetGroupByIdResponse = GroupDto;
export type CreateGroupResponse = GroupDto;
export type UpdateGroupResponse = GroupDto;
