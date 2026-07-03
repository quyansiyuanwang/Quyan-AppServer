import type { ApiResponse } from "@/api/dto/common/common.dto";

/**
 * 用户基本信息
 */
export interface UserDto {
  /** 用户ID */
  id: string;

  /** 用户名 */
  username: string;

  /**
   * 邮箱
   */
  email?: string | null;

  /**
   * 姓名
   */
  name?: string | null;

  /** 用户状态 */
  status?: number;

  /** 用户组ID */
  groupId?: string;

  /** 用户组名称 */
  groupName?: string | null;

  /** 账户余额 */
  balance?: number;

  /** 创建时间 */
  createdAt?: string;

  /** 更新时间 */
  updatedAt?: string;
}

/**
 * 创建用户请求
 */
export interface CreateUserDto {
  /**
   * 用户名
   */
  username: string;

  /**
   * 密码
   */
  password: string;

  /**
   * 邮箱
   */
  email?: string;

  /**
   * 姓名
   */
  name?: string;

  /** 用户组ID（可选） */
  groupId?: string;
}

/**
 * 更新用户请求
 */
export interface UpdateUserDto {
  /**
   * 邮箱（可选）
   */
  email?: string;

  /**
   * 姓名（可选）
   */
  name?: string;

  /**
   * 用户状态（可选）
   */
  status?: number;

  /** 用户组ID（可选） */
  groupId?: string;
}

/**
 * 更新个人资料请求（用户自己修改）
 */
export interface UpdateProfileDto {
  /**
   * 姓名（可选）
   */
  name?: string;
}

/**
 * 发送邮箱变更验证码请求
 */
export interface SendEmailChangeCodeDto {
  /**
   * 新邮箱
   */
  newEmail: string;

  /**
   * 验证码 token（可选，用于人机验证）
   */
  captchaToken?: string;
}

/**
 * 变更邮箱请求
 */
export interface ChangeEmailDto {
  /**
   * 新邮箱
   */
  newEmail: string;

  /**
   * 验证码
   */
  verificationCode: string;
}

/**
 * 获取所有用户响应
 */
export interface GetAllUsersData {
  users: UserDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface GetAllUsersQueryDto {
  page?: number;
  pageSize?: number;
  keyword?: string;
  userId?: string;
  groupId?: string;
  excludeCurrentUser?: boolean;
}

/**
 * 修改用户密码请求
 */
export interface ChangePasswordDTO {
  /**
   * 新密码
   */
  newPassword: string;
}

/**
 * 获取用户详情响应
 */
export type GetAllUsersResponse = GetAllUsersData;
export type GetUserByIdResponse = UserDto;
export type CreateUserResponse = UserDto;
export type UpdateUserResponse = UserDto;
export type ChangePasswordResponse = null;
export type UpdateProfileResponse = UserDto;
export type ChangeEmailResponse = { message: string };
export type SendEmailChangeCodeResponse = { message: string };
