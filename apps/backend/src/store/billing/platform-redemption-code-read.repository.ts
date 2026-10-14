import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isRedemptionCodeResourceId } from "@/iam/resources/platform-redemption-code-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformRedemptionCodeReadStore, RedemptionCodeReadTarget } from "./platform-redemption-code-read.store";
// Hash credential content inside the database; metadata scans never return redemption secrets.
export const redemptionCodeRevision = Prisma.sql`SHA2(CAST(JSON_ARRAY(id,status,code,amount,usedBy,usedAt,createdBy,expiresAt,createTime,updateTime) AS CHAR),256)`;
export function validRedemptionCodeTarget(row: RedemptionCodeReadTarget) {
  return (
    !!row &&
    isRedemptionCodeResourceId(row.id) &&
    row.status === 1 &&
    typeof row.revision === "string" &&
    /^[a-f0-9]{64}$/.test(row.revision) &&
    [row.createTime, row.updateTime].every((value) => value instanceof Date && Number.isFinite(value.getTime()))
  );
}
export function sameRedemptionCodeTargets(
  current: readonly RedemptionCodeReadTarget[],
  expected: readonly RedemptionCodeReadTarget[],
) {
  if (
    !Array.isArray(current) ||
    current.length !== expected.length ||
    new Set(current.map((row) => row.id)).size !== current.length ||
    current.some(
      (row) =>
        !validRedemptionCodeTarget(row) ||
        !expected.some(
          (previous) =>
            previous.id === row.id &&
            previous.revision === row.revision &&
            previous.createTime.getTime() === row.createTime.getTime() &&
            previous.updateTime.getTime() === row.updateTime.getTime(),
        ),
    )
  )
    throw iamAccountDenied();
}
export class PlatformRedemptionCodeReadRepository implements PlatformRedemptionCodeReadStore {
  private static instance: PlatformRedemptionCodeReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRedemptionCodeReadRepository());
  }
  private actor(principal: IamPrincipal, tx: Prisma.TransactionClient = prisma) {
    return platformManagementGroupSnapshot(principal, Permission.REDEMPTION_CODE_READ, tx);
  }
  async scan(principal: IamPrincipal, after?: string) {
    await this.actor(principal);
    if (after !== undefined && !isRedemptionCodeResourceId(after)) throw iamAccountDenied();
    return prisma.$queryRaw<RedemptionCodeReadTarget[]>(
      Prisma.sql`SELECT id,status,createTime,updateTime,${redemptionCodeRevision} AS revision FROM redemption_codes WHERE status=1 ${after ? Prisma.sql`AND id > ${after}` : Prisma.empty} ORDER BY id LIMIT ${IAM_AUTHORIZATION_LIMITS.resourcesPerRequest}`,
    );
  }
  private async targets(tx: Prisma.TransactionClient, expected: readonly RedemptionCodeReadTarget[], lock = false) {
    if (!expected.length) return [];
    if (
      expected.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(expected.map((row) => row.id)).size !== expected.length ||
      expected.some((row) => !validRedemptionCodeTarget(row))
    )
      throw iamAccountDenied();
    return tx.$queryRaw<RedemptionCodeReadTarget[]>(
      Prisma.sql`SELECT id,status,createTime,updateTime,${redemptionCodeRevision} AS revision FROM redemption_codes WHERE status=1 AND id IN (${Prisma.join(expected.map((row) => row.id))}) ORDER BY id ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
  }
  async recheck(principal: IamPrincipal, expected: readonly RedemptionCodeReadTarget[]) {
    await this.actor(principal);
    return this.targets(prisma, expected);
  }
  async hydrate(principal: IamPrincipal, expected: readonly RedemptionCodeReadTarget[]) {
    if (!expected.length) return [];
    return prisma.$transaction(
      async (tx) => {
        await this.actor(principal, tx);
        sameRedemptionCodeTargets(await this.targets(tx, expected, true), expected);
        const rows = await tx.redemptionCode.findMany({
          where: { status: 1, id: { in: expected.map((row) => row.id) } },
          include: { usedByUser: { select: { username: true } }, createdByUser: { select: { username: true } } },
        });
        if (rows.length !== expected.length) throw iamAccountDenied();
        await this.actor(principal, tx);
        return rows;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
