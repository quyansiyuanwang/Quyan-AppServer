import { z } from "zod";
import { AccountStatus } from "@/util/auth/account-status";

const usernameRegex = /^[a-zA-Z0-9_]+$/;
const USER_LIST_PAGE_SIZE_MAX = 100;

export const updateProfileBodySchema = z.object({
  name: z.string().max(50).optional(),
});

export const sendEmailChangeCodeBodySchema = z.object({
  newEmail: z.string().email().max(200),
  captchaToken: z.string().max(4000).optional(),
});

export const changeEmailBodySchema = z.object({
  newEmail: z.string().email().max(200),
  verificationCode: z.string().min(6).max(6),
});

export const createUserBodySchema = z.object({
  username: z.string().trim().min(3).max(20).regex(usernameRegex),
  password: z.string().min(6).max(50),
  email: z.string().email().max(200).optional(),
  name: z.string().max(50).optional(),
  groupId: z.string().trim().min(1).optional(),
});

export const updateUserBodySchema = z.object({
  email: z.string().email().max(200).optional(),
  name: z.string().max(50).optional(),
  status: z.coerce.number().int().min(AccountStatus.DISABLED).max(AccountStatus.ACTIVE).optional(),
  groupId: z.string().trim().min(1).optional(),
});

export const changePasswordBodySchema = z.object({
  newPassword: z.string().min(6).max(50),
});

export const userIdParamsSchema = z.object({
  userId: z.string().trim().min(1),
});

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(USER_LIST_PAGE_SIZE_MAX).optional(),
  keyword: z.string().trim().max(200).optional(),
  userId: z.string().trim().max(100).optional(),
  groupId: z.string().trim().max(100).optional(),
  excludeCurrentUser: z.coerce.boolean().optional(),
  userType: z.enum(["root", "ram_user"]).optional(),
  hasRamPermission: z.coerce.boolean().optional(),
});
