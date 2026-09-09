import { z } from "zod";
import { ALL_PERMISSIONS, Permission } from "@/constant/permission";

const usernameRegex = /^[a-zA-Z0-9_-]+$/;

export const groupIdParamsSchema = z.object({
  groupId: z.string().trim().min(1),
});

export const createGroupBodySchema = z.object({
  username: z.string().trim().min(2).max(30).regex(usernameRegex),
  name: z.string().max(50).optional(),
  level: z.coerce.number().int().min(0).max(100),
  description: z.string().max(200).optional(),
});

export const updateGroupBodySchema = z.object({
  name: z.string().max(50).optional(),
  level: z.coerce.number().int().min(0).max(100).optional(),
  description: z.string().max(200).optional(),
});

export const setGroupPermissionsBodySchema = z.object({
  // Keep the request contract in sync with the single shared permission source.
  // New permissions therefore do not require another hard-coded array limit.
  permissions: z.array(z.nativeEnum(Permission)).min(1).max(ALL_PERMISSIONS.length),
});

export const groupListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  keyword: z.string().trim().max(200).optional(),
  hasRamPermission: z.coerce.boolean().optional(),
});
