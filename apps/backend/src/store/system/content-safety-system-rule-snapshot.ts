import { Prisma } from "@prisma/client";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isContentSafetyRuleId } from "@/iam/resources/content-safety-system-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { ContentSafetySystemRuleTarget } from "./content-safety-system-read.store";
// Return only digests of content before authorization; keep read and write snapshots identical.
const revision = Prisma.sql`SHA2(CAST(JSON_ARRAY(id,status,createTime,updateTime,name,type,pattern,direction,action,enabled,priority,source,version,ownerUserId) AS CHAR),256)`;
export const CONTENT_SAFETY_SYSTEM_RULE_METADATA = Prisma.sql`id,status,createTime,updateTime,priority,${revision} AS revision`;
export function sameContentSafetySystemRuleTargets(
  actual: readonly ContentSafetySystemRuleTarget[],
  expected: readonly ContentSafetySystemRuleTarget[],
) {
  if (
    actual.length !== expected.length ||
    actual.some((row) => !expected.some((previous) => previous.id === row.id && previous.revision === row.revision))
  )
    throw iamAccountDenied();
}
export async function readContentSafetySystemRuleTargets(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
  lock = false,
) {
  if (!ids.length) return [];
  if (
    ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !isContentSafetyRuleId(id))
  )
    throw iamAccountDenied();
  return tx.$queryRaw<ContentSafetySystemRuleTarget[]>(
    Prisma.sql`SELECT ${CONTENT_SAFETY_SYSTEM_RULE_METADATA} FROM content_safety_rules WHERE status=1 AND ownerUserId IS NULL AND id IN (${Prisma.join([...ids])}) ORDER BY id ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
  );
}
