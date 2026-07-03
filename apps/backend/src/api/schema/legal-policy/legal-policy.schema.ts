import { z } from "zod";
import { LegalPolicyType } from "@/constant/legal-policy";

export const legalPolicyIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const createLegalPolicyBodySchema = z.object({
  policyType: z.nativeEnum(LegalPolicyType),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2000).optional(),
  content: z.string().min(1),
});

export const updateLegalPolicyBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().trim().max(2000).optional(),
    content: z.string().min(1).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "至少需要提供一个待更新字段",
    path: ["title"],
  });

export const getCurrentLegalPoliciesBodySchema = z.object({
  policyType: z.nativeEnum(LegalPolicyType).optional(),
  captchaToken: z.string().max(4000).optional(),
});
