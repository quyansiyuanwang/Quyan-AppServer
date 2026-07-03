import { z } from "zod";
import { AccountStatus } from "@/util/auth/account-status";

const usernameRegex = /^[a-zA-Z0-9_]+$/;
const roleNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;

export const ramUserIdParamsSchema = z.object({
  userId: z.string().trim().min(1),
});

export const ramRoleIdParamsSchema = z.object({
  roleId: z.string().trim().min(1),
});

export const ramSessionIdParamsSchema = z.object({
  sessionId: z.string().trim().min(1),
});

export const ramPolicyIdParamsSchema = z.object({
  policyId: z.string().trim().min(1),
});

export const createRamUserBodySchema = z.object({
  username: z.string().trim().min(3).max(50).regex(usernameRegex),
  password: z.string().min(6).max(50).optional(),
  ramUsername: z.string().trim().min(3).max(64).regex(usernameRegex).optional(),
  displayName: z.string().trim().max(80).optional(),
  email: z.string().email().max(200).optional(),
  name: z.string().max(50).optional(),
  groupId: z.string().trim().min(1).optional(),
  enableConsole: z.boolean().optional(),
  enableAccessKey: z.boolean().optional(),
  passwordResetRequired: z.boolean().optional(),
});

export const updateRamUserBodySchema = z.object({
  displayName: z.string().trim().max(80).optional(),
  email: z.string().email().max(200).optional(),
  name: z.string().max(50).optional(),
  status: z.coerce.number().int().min(AccountStatus.DISABLED).max(AccountStatus.ACTIVE).optional(),
  groupId: z.string().trim().min(1).optional(),
});

export const createRamRoleBodySchema = z.object({
  name: z.string().trim().min(2).max(64).regex(roleNameRegex),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string().trim().min(1)).max(500),
  trustPolicy: z.record(z.string(), z.unknown()).optional(),
  maxSessionDuration: z.coerce.number().int().min(900).max(43200).optional(),
});

export const updateRamRoleBodySchema = z.object({
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string().trim().min(1)).max(500).optional(),
  trustPolicy: z.record(z.string(), z.unknown()).nullable().optional(),
  maxSessionDuration: z.coerce.number().int().min(900).max(43200).optional(),
  status: z.coerce.number().int().min(AccountStatus.DISABLED).max(AccountStatus.ACTIVE).optional(),
});

export const bindRamRoleToUserBodySchema = z.object({
  userId: z.string().trim().min(1),
});

export const bindRamRoleToGroupBodySchema = z.object({
  groupId: z.string().trim().min(1),
});

export const assumeRamRoleBodySchema = z.object({
  roleId: z.string().trim().min(1),
  sessionName: z.string().trim().max(80).optional(),
  durationSeconds: z.coerce.number().int().min(900).max(43200).optional(),
});

// ── 权限策略 Schemas ──

export const createRamPolicyBodySchema = z.object({
  name: z.string().trim().min(2).max(128),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string().trim().min(1)).max(500),
});

export const updateRamPolicyBodySchema = z.object({
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string().trim().min(1)).max(500).optional(),
  status: z.coerce.number().int().min(0).max(1).optional(),
});

export const attachPolicyBodySchema = z.object({
  policyId: z.string().trim().min(1),
  targetType: z.enum(["user", "role", "group"]),
  targetId: z.string().trim().min(1),
});

export const detachPolicyBodySchema = z.object({
  policyId: z.string().trim().min(1),
  targetType: z.enum(["user", "role", "group"]),
  targetId: z.string().trim().min(1),
});

export const authorizationQuerySchema = z.object({
  userId: z.string().trim().min(1),
});
