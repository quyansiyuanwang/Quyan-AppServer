import { z } from "zod";

const quotaLimitSchema = z.coerce.number().int().min(0).max(999999);
const purchaseUnitCountSchema = z.coerce.number().int().min(1).max(3650);
const priceSchema = z.coerce.number().min(0).max(999999.9999);
const billingUnitSchema = z.enum(["day", "week", "month"]);

export const createRemoteTerminalSessionBodySchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  mode: z.enum(["shell"]),
  shellType: z.enum(["system-default", "cmd", "powershell", "pwsh", "bash", "zsh", "sh"]),
  workingDirectory: z.string().trim().max(500).optional(),
});

export const browseRemoteTerminalDirectoriesQuerySchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  path: z.string().trim().max(500).optional(),
});

const remoteTerminalShortcutSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    label: z.string().max(100),
    kind: z.enum(["sequence", "key"]),
    sequence: z.array(z.string().max(1000)).max(50),
    key: z.string().trim().max(100).optional(),
    modifiers: z
      .array(z.enum(["ctrl", "alt", "shift", "meta"]))
      .max(4)
      .optional(),
    preset: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.kind === "key" && !value.key?.trim())
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "key is required when kind=key",
        path: ["key"],
      });

    if (value.kind === "sequence" && value.sequence.length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sequence is required when kind=sequence",
        path: ["sequence"],
      });
  });

const remoteTerminalQuickCommandSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(100),
  command: z.string().max(4000),
});

export const remoteTerminalAgentPreferencesQuerySchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
});

export const updateRemoteTerminalAgentPreferencesBodySchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  defaultWorkingDirectory: z.string().trim().max(500).nullable().optional(),
  shortcuts: z.array(remoteTerminalShortcutSchema).max(100),
  quickCommands: z.array(remoteTerminalQuickCommandSchema).max(200),
});

const validDateString = (value: string): boolean => !Number.isNaN(Date.parse(value));

export const remoteTerminalTemplateIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const entitlementIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const remoteTerminalDeviceBindingIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const createRemoteTerminalProductTemplateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000).optional(),
    billingUnit: billingUnitSchema.optional(),
    minimumPurchaseUnits: purchaseUnitCountSchema.optional(),
    maximumPurchaseUnits: z.coerce.number().int().min(1).max(3650).nullable().optional(),
    devicePrice: z.union([z.null(), priceSchema]).optional(),
    terminalPrice: z.union([z.null(), priceSchema]).optional(),
    currency: z.string().trim().min(1).max(16).optional(),
    purchaseLimitPerUser: z.coerce.number().int().min(1).max(9999).nullable().optional(),
    purchaseLimitWindowDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
    minimumDeviceCount: z.coerce.number().int().min(1).max(9999).nullable().optional(),
    minimumTerminalCount: z.coerce.number().int().min(1).max(9999).nullable().optional(),
    maxDeviceCount: z.coerce.number().int().min(1).max(9999).nullable().optional(),
    maxTerminalCount: z.coerce.number().int().min(1).max(9999).nullable().optional(),
  })
  .refine((value) => value.devicePrice != null || value.terminalPrice != null, {
    message: "devicePrice and terminalPrice cannot both be empty",
    path: ["terminalPrice"],
  });

export const updateRemoteTerminalProductTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  billingUnit: billingUnitSchema.optional(),
  minimumPurchaseUnits: purchaseUnitCountSchema.optional(),
  maximumPurchaseUnits: z.union([z.null(), z.coerce.number().int().min(1).max(3650)]).optional(),
  devicePrice: z.union([z.null(), priceSchema]).optional(),
  terminalPrice: z.union([z.null(), priceSchema]).optional(),
  currency: z.string().trim().min(1).max(16).optional(),
  purchaseLimitPerUser: z.union([z.null(), z.coerce.number().int().min(1).max(9999)]).optional(),
  purchaseLimitWindowDays: z.union([z.null(), z.coerce.number().int().min(1).max(3650)]).optional(),
  minimumDeviceCount: z.union([z.null(), z.coerce.number().int().min(1).max(9999)]).optional(),
  minimumTerminalCount: z.union([z.null(), z.coerce.number().int().min(1).max(9999)]).optional(),
  maxDeviceCount: z.union([z.null(), z.coerce.number().int().min(1).max(9999)]).optional(),
  maxTerminalCount: z.union([z.null(), z.coerce.number().int().min(1).max(9999)]).optional(),
  status: z.coerce.number().int().min(-1).max(1).optional(),
});

export const claimRemoteTerminalProductTemplateBodySchema = z
  .object({
    templateId: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(100).optional(),
    purchaseUnits: purchaseUnitCountSchema,
    deviceCount: quotaLimitSchema,
    terminalCount: quotaLimitSchema,
    targetEntitlementId: z.string().trim().min(1).max(64).optional(),
  })
  .refine((value) => value.deviceCount > 0 || value.terminalCount > 0, {
    message: "deviceCount and terminalCount cannot both be 0",
    path: ["terminalCount"],
  });

export const assignRemoteTerminalEntitlementBodySchema = z.object({
  userId: z.string().trim().min(1).max(64),
  templateId: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  startAt: z
    .string()
    .max(40)
    .refine((value) => validDateString(value), "startAt must be a valid date string"),
  endAt: z
    .string()
    .max(40)
    .refine((value) => validDateString(value), "endAt must be a valid date string"),
  deviceLimit: quotaLimitSchema.optional(),
  terminalLimit: quotaLimitSchema.optional(),
  note: z.string().max(1000).optional(),
});

export const updateRemoteTerminalEntitlementBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  startAt: z
    .string()
    .max(40)
    .refine((value) => validDateString(value), "startAt must be a valid date string")
    .optional(),
  endAt: z
    .string()
    .max(40)
    .refine((value) => validDateString(value), "endAt must be a valid date string")
    .optional(),
  deviceLimit: quotaLimitSchema.optional(),
  terminalLimit: quotaLimitSchema.optional(),
  maxDeviceCount: z.number().int().min(0).nullable().optional(),
  maxTerminalCount: z.number().int().min(0).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  status: z.coerce.number().int().min(-1).max(1).optional(),
});

export const rotateRemoteTerminalRegistrationTokenBodySchema = z.object({
  label: z.string().max(100).nullable().optional(),
  expiresAt: z
    .string()
    .max(40)
    .refine((value) => validDateString(value), "expiresAt must be a valid date string")
    .nullable()
    .optional(),
});

export const listRemoteTerminalTemplatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.coerce.number().int().min(-1).max(1).optional(),
  keyword: z.string().trim().max(100).optional(),
});

export const listRemoteTerminalEntitlementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  userId: z.string().trim().min(1).max(64).optional(),
  templateId: z.string().trim().min(1).max(64).optional(),
  status: z.coerce.number().int().min(-1).max(1).optional(),
});

export const listRemoteTerminalDevicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  userId: z.string().trim().min(1).max(64).optional(),
  entitlementId: z.string().trim().min(1).max(64).optional(),
  status: z.coerce.number().int().min(-1).max(1).optional(),
});
