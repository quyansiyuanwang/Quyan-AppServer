import { z } from "zod";
import { ALL_PERMISSIONS, Permission } from "@/constant/permission";

const permissionSchema = z.nativeEnum(Permission);
const maxPermissionCount = ALL_PERMISSIONS.length;

export const permissionUserIdParamsSchema = z.object({
  userId: z.string().trim().min(1),
});

export const permissionGroupIdParamsSchema = z.object({
  groupId: z.string().trim().min(1),
});

export const setUserPermissionsBodySchema = z.object({
  permissionAdds: z.array(permissionSchema).max(maxPermissionCount).optional(),
  permissionRemoves: z.array(permissionSchema).max(maxPermissionCount).optional(),
});

export const addOrRemovePermissionsBodySchema = z.object({
  permissions: z.array(permissionSchema).min(1).max(maxPermissionCount),
});

export const checkPermissionsBodySchema = z.object({
  userId: z.string().trim().min(1).max(50),
  permissions: z.array(permissionSchema).min(1).max(maxPermissionCount),
});
