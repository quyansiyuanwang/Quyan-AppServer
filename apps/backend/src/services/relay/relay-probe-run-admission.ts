import { z } from "zod";
import { isIP } from "node:net";
import { IAM_SUBJECT_TYPES } from "@quyan/shared";
import { RedisService } from "@/services/infrastructure/redis.service";
import { RELAY_PROBE_QUEUE_POLICY } from "./relay-channel-probe-queue-policy";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const nullableId = identifier.nullable();
const transportSchema = z
  .object({
    "acs:SourceIp": z
      .string()
      .refine((value) => isIP(value) !== 0)
      .optional(),
    "acs:SecureTransport": z.boolean(),
    "acs:UserAgent": z
      .string()
      .max(512)
      .refine((value) => [...value].every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127))
      .optional(),
  })
  .strict();
const admissionSchema = z
  .object({
    version: z.literal(1),
    runId: identifier,
    channelId: identifier,
    memberChannelId: nullableId,
    profileId: identifier,
    profileUpdatedAt: z.string().datetime(),
    targetConfigId: nullableId,
    targetConfigUpdatedAt: z.string().datetime().nullable(),
    accountId: nullableId,
    principal: z
      .object({
        subjectUserId: identifier,
        principalUserId: identifier,
        accountOwnerId: identifier,
        subjectType: z.enum(IAM_SUBJECT_TYPES),
        assumedRoleId: identifier.optional(),
        roleSessionId: identifier.optional(),
      })
      .strict()
      .refine((value) => value.subjectUserId === value.principalUserId)
      .refine((value) =>
        value.subjectType === "assumed_role"
          ? Boolean(value.assumedRoleId && value.roleSessionId)
          : !value.assumedRoleId && !value.roleSessionId,
      )
      .refine((value) => value.subjectType !== "root" || value.principalUserId === value.accountOwnerId),
    identity: z
      .object({
        principalUpdatedAt: z.string().datetime(),
        ownerUpdatedAt: z.string().datetime(),
        accessKeyId: identifier.optional(),
        accessKeyRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
    transport: transportSchema,
    expiresAt: z.number().finite().int().positive(),
  })
  .strict()
  .refine((value) => Boolean(value.targetConfigId) === Boolean(value.targetConfigUpdatedAt))
  .refine((value) => !value.accountId || Boolean(value.targetConfigId))
  .refine((value) => Boolean(value.identity.accessKeyId) === Boolean(value.identity.accessKeyRevision))
  .refine((value) => value.principal.subjectType !== "access_key" || Boolean(value.identity.accessKeyId));
export type RelayProbeRunAdmission = z.infer<typeof admissionSchema>;
const admissionKey = (runId: string) => `relay:probe-run-admission:v1:${identifier.parse(runId)}`;
export function parseProbeRunAdmission(value: unknown): RelayProbeRunAdmission {
  const parsed = admissionSchema.safeParse(value),
    now = Date.now();
  if (
    !parsed.success ||
    parsed.data.expiresAt <= now ||
    parsed.data.expiresAt > now + RELAY_PROBE_QUEUE_POLICY.slotTtlMs
  )
    throw iamAccountDenied();
  return parsed.data;
}
export class RelayProbeRunAdmissionStore {
  private static instance: RelayProbeRunAdmissionStore;
  static getInstance() {
    return (this.instance ??= new RelayProbeRunAdmissionStore());
  }
  constructor(
    private readonly redis: Pick<
      RedisService,
      "getWithResult" | "setIfNotExists" | "deleteIfValueMatches"
    > = RedisService.getInstance(),
  ) {}
  async save(input: RelayProbeRunAdmission): Promise<() => Promise<void>> {
    const value = JSON.stringify(parseProbeRunAdmission(input));
    if (value.length > 8192) throw iamAccountDenied();
    const key = admissionKey(input.runId);
    if ((await this.redis.setIfNotExists(key, value, Math.max(1, input.expiresAt - Date.now()))) !== true)
      throw iamAccountDenied();
    return async () => {
      if ((await this.redis.deleteIfValueMatches(key, value)) === null) throw iamAccountDenied();
    };
  }
  async read(runId: string): Promise<RelayProbeRunAdmission> {
    const result = await this.redis.getWithResult(admissionKey(runId));
    if (!result?.value || result.value.length > 8192) throw iamAccountDenied();
    try {
      const input: unknown = JSON.parse(result.value);
      return parseProbeRunAdmission(input);
    } catch {
      throw iamAccountDenied();
    }
  }
}
