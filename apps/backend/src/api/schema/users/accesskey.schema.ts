import { z } from "zod";

const validDateString = (value: string): boolean => {
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
};

export const createAccessKeyBodySchema = z.object({
  name: z.string().max(100).optional(),
  expiresAt: z
    .string()
    .max(50)
    .refine((value) => validDateString(value), "expiresAt must be a valid date string")
    .optional(),
  verificationCode: z.string().min(6).max(6).optional(),
});

export const accesskeyIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});
