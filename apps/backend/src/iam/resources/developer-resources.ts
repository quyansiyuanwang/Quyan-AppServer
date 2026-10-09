import { buildAcsResource } from "@quyan/shared";
import {
  developerProjectIdSchema,
  developerKvKeySchema,
  developerSecretAliasSchema,
} from "@/api/schema/developer/developer.schema";
/** Validation and normalization have one source; callers must pass its canonical value. */
export function isCanonicalDeveloperIdentifier(
  schema: typeof developerProjectIdSchema,
  input: unknown,
): input is string {
  const parsed = schema.safeParse(input);
  return parsed.success && parsed.data === input;
}

export function developerProjectArn(accountOwnerId: string, projectId: string): string {
  if (!isCanonicalDeveloperIdentifier(developerProjectIdSchema, projectId))
    throw new Error("Invalid project identifier");
  return buildAcsResource({
    service: "developer",
    region: "*",
    accountId: accountOwnerId,
    path: "project/" + projectId,
  });
}
/** Keys are reversible UTF-8 base64url segments, without padding; no key can become a wildcard or delimiter. */
export function developerKvArn(accountOwnerId: string, projectId: string, key: string): string {
  if (
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, projectId) ||
    !isCanonicalDeveloperIdentifier(developerKvKeySchema, key)
  )
    throw new Error("Invalid KV identifier");
  return buildAcsResource({
    service: "developer",
    region: "*",
    accountId: accountOwnerId,
    path: "kv-item/" + projectId + "/" + Buffer.from(key, "utf8").toString("base64url"),
  });
}
export function developerSecretArn(accountOwnerId: string, projectId: string, alias: string): string {
  if (
    !isCanonicalDeveloperIdentifier(developerProjectIdSchema, projectId) ||
    !isCanonicalDeveloperIdentifier(developerSecretAliasSchema, alias)
  )
    throw new Error("Invalid secret identifier");
  return buildAcsResource({
    service: "developer",
    region: "*",
    accountId: accountOwnerId,
    path: "secret/" + projectId + "/" + alias,
  });
}

/** Rejects alternate encodings so resource-group membership has one exact key identity. */
export function developerKvKeyFromArnSegment(segment: string): string | undefined {
  const key = Buffer.from(segment, "base64url").toString("utf8");
  return isCanonicalDeveloperIdentifier(developerKvKeySchema, key) &&
    Buffer.from(key, "utf8").toString("base64url") === segment
    ? key
    : undefined;
}
