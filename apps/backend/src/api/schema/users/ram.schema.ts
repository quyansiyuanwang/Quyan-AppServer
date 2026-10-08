import { IAM_POLICY_DRAFT_LIMITS } from "@/iam/ai/draft-limits";
import { iamTrustPolicyDocumentSchema } from "@/iam/trust/trust-policy";
import { iamManagementPaginationSchema } from "@/iam/management-pagination";
import { z } from "zod";
export { iamVersionPaginationSchema as ramPolicyVersionsQuerySchema } from "@/iam/policy-version-pagination";
import { ALL_PERMISSIONS } from "@/constant/permission";
import { AccountStatus } from "@/util/auth/account-status";
import { encryptedPasswordCredentialSchema } from "@/api/schema/auth/password-encryption.schema";

import { iamPolicyDocumentSchema, IAM_POLICY_LIMITS } from "@/iam/parser/policy-schema";
import { isKnownIamAction, isValidIamResource } from "@quyan/shared";

const usernameRegex = /^[a-zA-Z0-9_]+$/;
const roleNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;
const permissionSchema = z.enum(ALL_PERMISSIONS as [string, ...string[]]);

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

export const createRamUserBodySchema = z
  .object({
    username: z.string().trim().min(3).max(50).regex(usernameRegex),
    password: z.string().min(6).max(50).optional(),
    passwordCredential: encryptedPasswordCredentialSchema.optional(),
    ramUsername: z.string().trim().min(3).max(64).regex(usernameRegex).optional(),
    displayName: z.string().trim().max(80).optional(),
    email: z.string().email().max(200).optional(),
    name: z.string().max(50).optional(),
    groupId: z.string().trim().min(1).optional(),
    enableConsole: z.boolean().optional(),
    enableAccessKey: z.boolean().optional(),
    passwordResetRequired: z.boolean().optional(),
  })
  .refine((data) => !(data.password && data.passwordCredential), {
    message: "password and passwordCredential cannot be submitted together",
    path: ["password"],
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
  trustPolicy: iamTrustPolicyDocumentSchema.optional(),
  maxSessionDuration: z.coerce.number().int().min(900).max(43200).optional(),
});

export const updateRamRoleBodySchema = z.object({
  expectedTrustPolicyHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  description: z.string().trim().max(500).optional(),
  trustPolicy: iamTrustPolicyDocumentSchema.nullable().optional(),
  maxSessionDuration: z.coerce.number().int().min(900).max(43200).optional(),
  status: z.coerce.number().int().min(AccountStatus.DISABLED).max(AccountStatus.ACTIVE).optional(),
});

export const setRamRoleTrustPolicyBodySchema = z
  .object({
    document: iamTrustPolicyDocumentSchema,
    expectedDocumentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

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

export const createRamPolicyBodySchema = z
  .object({
    name: z.string().trim().min(2).max(128),
    description: z.string().trim().max(500).optional(),
    permissions: z.array(permissionSchema).max(500).optional(),
    document: iamPolicyDocumentSchema.optional(),
  })
  .strict()
  .refine(
    (data) => (data.permissions !== undefined) !== (data.document !== undefined),
    "Exactly one of permissions or document is required",
  );

export const updateRamPolicyBodySchema = z
  .object({
    document: iamPolicyDocumentSchema.optional(),
    expectedDocumentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    description: z.string().trim().max(500).optional(),
    permissions: z.array(permissionSchema).max(500).optional(),
    status: z.coerce.number().int().min(0).max(1).optional(),
  })
  .strict()
  .refine(
    (data) => !(data.permissions !== undefined && data.document !== undefined),
    "Cannot mix legacy permissions and IAM document",
  );

export const diagnoseIamPolicyBodySchema = z
  .object({
    documentText: z.string().max(IAM_POLICY_LIMITS.bytes),
    policyKind: z.enum(["identity", "trust"]).optional(),
  })
  .strict();
export const validateIamPolicyBodySchema = z.object({ document: iamPolicyDocumentSchema }).strict();
export const createRamPolicyVersionBodySchema = z
  .object({
    document: iamPolicyDocumentSchema,
    expectedDocumentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export const setDefaultRamPolicyVersionBodySchema = z
  .object({ versionId: z.string().min(1).max(128), expectedDocumentHash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const simulateIamPolicyBodySchema = z
  .object({
    principalId: z.string().min(1).max(128),
    action: z.string().refine(isKnownIamAction),
    resource: z.string().refine(isValidIamResource),
  })
  .strict();

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

export const ramGroupListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  keyword: z.string().trim().optional(),
});

export const authorizationQuerySchema = z.object({
  userId: z.string().trim().min(1),
});

export const iamAuthorizationQuerySchema = iamManagementPaginationSchema
  .extend({
    principalType: z.enum(["user", "group", "role"]).optional(),
    principalId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();
export const iamResourceGroupQuerySchema = iamManagementPaginationSchema.strict();
export const createIamAuthorizationBodySchema = z
  .object({
    principalType: z.enum(["user", "group", "role"]),
    principalId: z.string().trim().min(1).max(128),
    policyId: z.string().trim().min(1).max(128),
    scopeType: z.enum(["account", "resource-group", "resource"]),
    scopeResourceId: z.string().trim().min(1).max(128).optional(),
    scopeArn: z.string().trim().min(1).max(512).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scopeType === "account" && (value.scopeResourceId || value.scopeArn))
      context.addIssue({ code: "custom", path: ["scopeType"], message: "Account scope cannot include a resource" });
    if (value.scopeType === "resource-group" && (!value.scopeResourceId || value.scopeArn))
      context.addIssue({
        code: "custom",
        path: ["scopeResourceId"],
        message: "Resource-group scope requires a group ID",
      });
    if (value.scopeType === "resource" && (!value.scopeArn || value.scopeResourceId))
      context.addIssue({ code: "custom", path: ["scopeArn"], message: "Resource scope requires an ARN" });
  })
  .transform((value) => value);
export const createRamResourceGroupBodySchema = z
  .object({ name: z.string().trim().min(1).max(128), description: z.string().trim().max(500).optional() })
  .strict();
export const addRamResourceGroupMemberBodySchema = z
  .object({ resourceArn: z.string().trim().min(1).max(512) })
  .strict();
export const resourceGroupIdParamsSchema = z.object({ groupId: z.string().trim().min(1).max(128) });
export const resourceGroupMemberParamsSchema = z.object({
  groupId: z.string().trim().min(1).max(128),
  memberId: z.string().trim().min(1).max(128),
});

export const authorizationIdParamsSchema = z.object({ authorizationId: z.string().trim().min(1).max(128) });

export const generateIamPolicyDraftBodySchema = z
  .object({
    instruction: z.string().trim().min(1).max(IAM_POLICY_DRAFT_LIMITS.instructionCharacters),
    model: z.string().trim().min(1).max(IAM_POLICY_DRAFT_LIMITS.modelCharacters),
    relayTokenId: z.string().trim().min(1).max(IAM_POLICY_DRAFT_LIMITS.tokenIdCharacters),
    policyKind: z.enum(["identity", "trust"]).optional(),
    currentDocumentText: z.string().max(IAM_POLICY_DRAFT_LIMITS.inputCharacters).optional(),
  })
  .strict();
