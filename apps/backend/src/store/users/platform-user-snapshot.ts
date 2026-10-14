import { Prisma } from "@prisma/client";
import { AccountStatus } from "@/util/auth/account-status";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformUserId } from "@/iam/resources/platform-user-resources";
import { iamAccountDenied } from "./iam-account-principal";
import type { PlatformUserReadTarget } from "./platform-user-read.store";
// Hash only data used by the directory or its filters. Credential columns are never selected or hashed.
const revision = Prisma.sql`SHA2(CAST(JSON_ARRAY(u.id,u.status,u.createTime,u.updateTime,u.username,u.email,u.name,u.accountOwnerId,u.parentUserId,u.userType,u.groupId,u.permissionAdds,u.permissionRemoves,g.name,g.username,g.status,g.level,g.permissions,g.accountOwnerId,b.balance,b.status,b.updateTime) AS CHAR),256)`;
export function validPlatformUserTarget(row: PlatformUserReadTarget) {
  return (
    !!row &&
    isPlatformUserId(row.id) &&
    [AccountStatus.DISABLED, AccountStatus.ACTIVE].includes(row.status) &&
    typeof row.revision === "string" &&
    /^[a-f0-9]{64}$/.test(row.revision) &&
    [row.createTime, row.updateTime].every((value) => value instanceof Date && Number.isFinite(value.getTime()))
  );
}
export function samePlatformUserTargets(
  current: readonly PlatformUserReadTarget[],
  expected: readonly PlatformUserReadTarget[],
) {
  if (
    !Array.isArray(current) ||
    current.length !== expected.length ||
    new Set(current.map((row) => row.id)).size !== current.length ||
    current.some(
      (row) =>
        !validPlatformUserTarget(row) ||
        !expected.some(
          (previous) => previous.id === row.id && previous.status === row.status && previous.revision === row.revision,
        ),
    )
  )
    throw iamAccountDenied();
}
export async function readPlatformUserTargets(tx: Prisma.TransactionClient, ids: readonly string[], lock = false) {
  if (!ids.length) return Promise.resolve([]);
  if (
    ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !isPlatformUserId(id))
  )
    throw iamAccountDenied();
  return tx.$queryRaw<PlatformUserReadTarget[]>(
    Prisma.sql`SELECT u.id,u.status,u.createTime,u.updateTime,${revision} AS revision FROM users u LEFT JOIN \`groups\` g ON g.id=u.groupId LEFT JOIN balance_accounts b ON b.userId=u.id WHERE u.status IN (${AccountStatus.DISABLED},${AccountStatus.ACTIVE}) AND u.id IN (${Prisma.join(ids)}) ORDER BY u.createTime DESC,u.id DESC ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
  );
}
