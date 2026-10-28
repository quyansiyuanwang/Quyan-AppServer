import type { DeveloperPushChannel, Prisma } from "@prisma/client";
import type {
  DeveloperPushChannelDto,
  DeveloperPushSecretReferenceDto,
  UpdateDeveloperPushChannelDto,
} from "@/api/dto/developer/developer.dto";

export interface StoredPushSecretReference {
  secretInstanceId: string;
  secretProjectId: string;
}
export type PushChannelSnapshot = Pick<
  DeveloperPushChannel,
  "id" | "projectId" | "name" | "type" | "endpoint" | "secretAlias" | "config" | "enabled" | "createTime" | "updateTime"
>;
export function readStoredPushSecretReference(config: unknown): StoredPushSecretReference | undefined {
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
  const value = config as Record<string, unknown>;
  if (typeof value.secretInstanceId !== "string" || typeof value.secretProjectId !== "string") return undefined;
  return { secretInstanceId: value.secretInstanceId, secretProjectId: value.secretProjectId };
}
export function pushChannelSecretReferenceDto(channel: {
  secretAlias: string | null;
  config: Prisma.JsonValue | null;
}): DeveloperPushSecretReferenceDto | undefined {
  const reference = readStoredPushSecretReference(channel.config);
  return reference && channel.secretAlias
    ? { secretInstanceId: reference.secretInstanceId, alias: channel.secretAlias }
    : undefined;
}
export function toDeveloperPushChannelDto(channel: Omit<PushChannelSnapshot, "projectId">): DeveloperPushChannelDto {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    endpoint: channel.endpoint ?? "",
    secretReference: pushChannelSecretReferenceDto(channel),
    secretAlias: channel.secretAlias ?? undefined,
    enabled: channel.enabled,
    createTime: channel.createTime.toISOString(),
    updateTime: channel.updateTime.toISOString(),
  };
}
/** Changing the destination or enabling a bound credential is a credential-use operation, not ordinary metadata editing. */
export function requiresPushSecretAuthority(
  body: UpdateDeveloperPushChannelDto,
  snapshot: PushChannelSnapshot,
): boolean {
  if (body.secretReference !== undefined) return body.secretReference !== null;
  return Boolean(snapshot.secretAlias && (body.endpoint !== undefined || body.enabled === true));
}
