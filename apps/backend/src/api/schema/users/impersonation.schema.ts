import { z } from "zod";

export const startImpersonationBodySchema = z.object({
  targetUserId: z.string().min(1, "目标用户 ID 不能为空"),
});
