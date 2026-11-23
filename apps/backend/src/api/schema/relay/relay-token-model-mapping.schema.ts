import { z } from "zod";
import {
  RELAY_CONVERTIBLE_REQUEST_FORMATS,
  RELAY_REQUEST_FORMATS,
  RELAY_TOKEN_MODEL_MAPPING_LIMITS,
} from "@quyan/shared";
import { RELAY_TOKEN_ROUTING_LIMITS } from "@/constant/relay-token";
import { RELAY_COMPOSITION_POLICY } from "@/util/relay/relay-composition.util";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { relayTokenFailoverConfigSchema } from "./relay.schema";

const id = z.string().max(50).refine(isRelayTokenResourceId);
const priority = z.number().int().min(0).max(999);
const transforms = z
  .array(
    z
      .object({
        sourceFormat: z.enum(RELAY_CONVERTIBLE_REQUEST_FORMATS),
        targetFormat: z.enum(RELAY_CONVERTIBLE_REQUEST_FORMATS),
      })
      .strict(),
  )
  .max(RELAY_CONVERTIBLE_REQUEST_FORMATS.length)
  .superRefine((rules, ctx) => {
    if (rules.some((rule) => rule.sourceFormat === rule.targetFormat))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Transform source and target must differ",
        params: { messageKey: "relayToken.formatTransformSameSourceTarget" },
      });
    if (new Set(rules.map((rule) => rule.sourceFormat)).size !== rules.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Transform source formats must be unique",
        params: { messageKey: "relayToken.formatTransformSourceUnique" },
      });
  });

export const relayTokenModelMappingDraftSchema = z
  .object({
    routingMode: z.enum(["ordered", "automatic-pool", "composite"]).optional(),
    channelId: id.nullable().optional(),
    channelConfigs: z
      .array(z.object({ channelId: id, priority }).strict())
      .max(RELAY_TOKEN_ROUTING_LIMITS.channels)
      .optional(),
    automaticProxyPoolChannelId: id.nullable().optional(),
    blockedAutomaticProxyPoolChannelIds: z
      .array(id)
      .max(RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxChannelIds)
      .nullable()
      .optional(),
    memberTokenConfigs: z
      .array(z.object({ tokenId: id, priority, enabled: z.boolean().default(true) }).strict())
      .max(RELAY_COMPOSITION_POLICY.maxMembers)
      .optional(),
    editingTokenId: id.optional(),
    targetUserId: id.optional(),
    allowedModels: z.string().max(2000).nullable().optional(),
    requestFormatTransforms: transforms.nullable().optional(),
    failoverConfig: relayTokenFailoverConfigSchema
      .pick({ maxAcceptedChannelMultiplier: true })
      .strict()
      .nullable()
      .optional(),
    modelMapping: z
      .record(
        z.string().min(1).max(RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxPatternLength),
        z.string().min(1).max(RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxTargetLength),
      )
      .refine((mapping) => Object.keys(mapping).length <= RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxRules, {
        message: "Too many mapping rules",
        params: { messageKey: "relayToken.modelMappingRulesInvalid" },
      })
      .nullable()
      .optional(),
    // Structural errors are returned as preview diagnostics; scope IDs still receive authorization checks.
    modelMappingRules: z
      .array(
        z
          .object({
            source: z.string().max(RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxPatternLength),
            target: z.string().max(RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxTargetLength),
            channelIds: z.array(id).max(RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxChannelIds).optional(),
            preference: z.enum(["mapping-first", "original-first"]),
          })
          .strict(),
      )
      .max(RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxRules)
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((draft, ctx) => {
    if (draft.modelMapping !== undefined && draft.modelMappingRules !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Model mapping representations are mutually exclusive",
        params: { messageKey: "relayToken.modelMappingMutuallyExclusive" },
        path: ["modelMappingRules"],
      });
    for (const [values, key, messageKey] of [
      [draft.channelConfigs?.map((row) => row.channelId), "channelConfigs", "relayToken.channelIdUnique"],
      [draft.channelConfigs?.map((row) => row.priority), "channelConfigs", "relayToken.priorityUnique"],
      [
        draft.memberTokenConfigs?.map((row) => row.tokenId),
        "memberTokenConfigs",
        "relayToken.compositionInvalidMember",
      ],
      [draft.memberTokenConfigs?.map((row) => row.priority), "memberTokenConfigs", "relayToken.priorityUnique"],
    ] as const) {
      if (values && new Set<string | number>(values).size !== values.length)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate routing selection",
          params: { messageKey },
          path: [key],
        });
    }
  });

const pagination = { page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(200).default(20) };
export const relayTokenModelMappingPreviewBodySchema = z
  .object({
    draft: relayTokenModelMappingDraftSchema,
    requestModel: z.string().min(1).max(RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxPatternLength),
    requestFormat: z.enum(RELAY_REQUEST_FORMATS),
    ...pagination,
  })
  .strict();
export const relayTokenModelMappingChannelOptionsBodySchema = z
  .object({
    draft: relayTokenModelMappingDraftSchema,
    search: z.string().max(200).default(""),
    selectedIds: z.array(id).max(RELAY_TOKEN_MODEL_MAPPING_LIMITS.maxChannelIds).default([]),
    ...pagination,
  })
  .strict();
