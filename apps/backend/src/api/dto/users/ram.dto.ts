import type { Permission } from "@/constant/permission";

export interface RamUserDto {
  id: string;
  username: string;
  ramUsername?: string | null;
  displayName?: string | null;
  email?: string | null;
  name?: string | null;
  status: number;
  groupId?: string | null;
  accountOwnerId?: string | null;
  parentUserId?: string | null;
  userType?: string | null;
  createdAt: string;
  updatedAt: string;
  accessKeyId?: string | null;
  accessKeySecret?: string | null;
  forcePasswordChange?: boolean | null;
}

export interface CreateRamUserDto {
  username: string;
  password?: string;
  ramUsername?: string;
  displayName?: string;
  email?: string;
  name?: string;
  groupId?: string;
  enableConsole?: boolean;
  enableAccessKey?: boolean;
  passwordResetRequired?: boolean;
}

export interface UpdateRamUserDto {
  displayName?: string;
  email?: string;
  name?: string;
  status?: number;
  groupId?: string;
}

export interface RamRoleDto {
  id: string;
  accountOwnerId: string;
  name: string;
  description?: string | null;
  permissions: string[];
  trustPolicy?: Record<string, unknown> | null;
  maxSessionDuration: number;
  status: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRamRoleDto {
  name: string;
  description?: string;
  trustPolicy?: Record<string, unknown>;
  maxSessionDuration?: number;
}

export interface UpdateRamRoleDto {
  description?: string;
  trustPolicy?: Record<string, unknown> | null;
  maxSessionDuration?: number;
  status?: number;
}

export interface RamRoleBindingDto {
  id: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  source: "user" | "group";
  principalId: string;
}

export interface BindRamRoleToUserDto {
  userId: string;
}

export interface BindRamRoleToGroupDto {
  groupId: string;
}

export interface AssumeRamRoleDto {
  roleId: string;
  sessionName?: string;
  durationSeconds?: number;
}

export interface AssumeRamRoleResponseDto {
  accessToken: string;
  expiresAt: string;
  session: RamRoleSessionDto;
}

export interface RamRoleSessionDto {
  id: string;
  accountOwnerId: string;
  subjectUserId: string;
  roleId: string;
  roleName: string;
  sessionName: string;
  expiresAt: string;
  status: number;
  createdAt: string;
}

export type GetRamUsersResponse = RamUserDto[];
export type CreateRamUserResponse = RamUserDto;
export type UpdateRamUserResponse = RamUserDto;
export type GetRamRolesResponse = RamRoleDto[];
export type CreateRamRoleResponse = RamRoleDto;
export type UpdateRamRoleResponse = RamRoleDto;
export type GetRamRoleBindingsResponse = RamRoleBindingDto[];
export type GetRamRoleSessionsResponse = RamRoleSessionDto[];

// ── RAM 权限策略 DTO ──

export interface RamPolicyDto {
  id: string;
  accountOwnerId: string;
  name: string;
  description?: string;
  permissions: Permission[];
  type: string;
  status: number;
  createTime: string;
  updateTime: string;
}

export interface CreateRamPolicyDto {
  name: string;
  description?: string;
  permissions: Permission[];
}

export interface UpdateRamPolicyDto {
  description?: string;
  permissions?: Permission[];
  status?: number;
}

// ── 权限策略绑定 DTO ──

export interface RamPolicyAttachmentDto {
  id: string;
  accountOwnerId: string;
  policyId: string;
  policyName: string;
  targetType: string;
  targetId: string;
  targetName?: string;
  createTime: string;
}

export interface AttachPolicyBodyDto {
  policyId: string;
  targetType: "user" | "role" | "group";
  targetId: string;
}

// ── 授权概览 DTO ──

export interface EffectivePermissionDto {
  userId: string;
  username: string;
  ramUsername: string;
  directPermissions: string[];
  groupPermissions: string[];
  rolePermissions: string[];
  policyPermissions: string[];
  permissionRemoves: string[];
  effectivePermissions: string[];
}

export type GetRamPoliciesResponse = RamPolicyDto[];
export type CreateRamPolicyResponse = RamPolicyDto;
export type UpdateRamPolicyResponse = RamPolicyDto;
export type GetRamPolicyAttachmentsResponse = RamPolicyAttachmentDto[];

// ── RAM 用户组 DTO ──

export interface RamGroupDto {
  id: string;
  username: string;
  name?: string | null;
  permissions: string[];
  level: number;
  description?: string | null;
  userCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type GetRamGroupsResponse = RamGroupDto[];
