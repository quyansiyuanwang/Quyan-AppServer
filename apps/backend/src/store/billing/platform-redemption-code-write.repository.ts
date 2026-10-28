import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { createRedemptionCodeBodySchema } from "@/api/schema/billing/redemption-code.schema";
import { isRedemptionCodeResourceId } from "@/iam/resources/platform-redemption-code-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamAccountDenied, assertIamAccountPrincipal } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { ConflictError, BadRequestError } from "@/util/errors";
import {
  redemptionCodeRevision,
  validRedemptionCodeTarget,
  sameRedemptionCodeTargets,
} from "./platform-redemption-code-read.repository";
import type { RedemptionCodeReadTarget } from "./platform-redemption-code-read.store";
import type { CreateRedemptionCodeDto } from "@/api/dto/billing/redemption-code.dto";
import type {
  PlatformRedemptionCodeWriteStore,
  RedemptionCodeWriteGuard,
} from "./platform-redemption-code-write.store";
// Bulk issuance can contain 1000 rows; bound the serializable transaction explicitly.
const transactionTimeoutMs = 30000;
export function normalizeRedemptionCodeCreate(input: CreateRedemptionCodeDto) {
  const parsed = createRedemptionCodeBodySchema.safeParse(input);
  if (!parsed.success)
    throw new BadRequestError("Invalid redemption creation input", undefined, { messageKey: "errors.badRequest" });
  if (parsed.data.expiresAt && parsed.data.expiresAt <= new Date())
    throw new BadRequestError("Redemption expiry must be in the future", undefined, {
      messageKey: "errors.expiryMustBeFuture",
    });
  return { ...parsed.data, count: parsed.data.count ?? 1 };
}
export class PlatformRedemptionCodeWriteRepository implements PlatformRedemptionCodeWriteStore {
  private static instance: PlatformRedemptionCodeWriteRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRedemptionCodeWriteRepository());
  }
  async authorizationRevision(principal: IamPrincipal) {
    await assertIamAccountPrincipal(principal);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  async target(principal: IamPrincipal, id: string) {
    await platformManagementGroupSnapshot(principal, Permission.REDEMPTION_CODE_DELETE);
    if (!isRedemptionCodeResourceId(id)) throw iamAccountDenied();
    const rows = await prisma.$queryRaw<RedemptionCodeReadTarget[]>(
      Prisma.sql`SELECT id,status,createTime,updateTime,${redemptionCodeRevision} AS revision FROM redemption_codes WHERE id=${id} AND status=1`,
    );
    return rows[0] ?? null;
  }
  private async identity(tx: Prisma.TransactionClient, guard: RedemptionCodeWriteGuard, permission: Permission) {
    if (guard.permission !== permission || !guard.group || !/^[a-f0-9]{64}$/.test(guard.authorizationRevision))
      throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`);
    const current = await platformManagementGroupSnapshot(guard.users.principal, permission, tx);
    if (
      current.id !== guard.group.id ||
      current.updateTime.getTime() !== guard.group.updateTime.getTime() ||
      (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== guard.authorizationRevision
    )
      throw iamAccountDenied();
  }
  private async transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: transactionTimeoutMs,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Redemption creation or authorization context changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
  async create(input: CreateRedemptionCodeDto, guard: RedemptionCodeWriteGuard) {
    const normalized = normalizeRedemptionCodeCreate(input);
    return this.transaction(async (tx) => {
      await this.identity(tx, guard, Permission.REDEMPTION_CODE_CREATE);
      const rows = [];
      for (let index = 0; index < normalized.count; index++)
        rows.push(
          await tx.redemptionCode.create({
            data: {
              code: randomBytes(16).toString("hex"),
              amount: normalized.amount,
              createdBy: guard.users.principal.subjectUserId,
              expiresAt: normalized.expiresAt ?? null,
            },
          }),
        );
      const ids = rows.map((row) => row.id);
      for (let index = 0; index < ids.length; index += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
        await guard.recheckEntries(ids.slice(index, index + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest));
      await this.identity(tx, guard, Permission.REDEMPTION_CODE_CREATE);
      for (let index = 0; index < ids.length; index += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest)
        await guard.recheckEntries(ids.slice(index, index + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest));
      return rows;
    });
  }
  async remove(target: RedemptionCodeReadTarget, guard: RedemptionCodeWriteGuard) {
    if (!validRedemptionCodeTarget(target)) throw iamAccountDenied();
    return this.transaction(async (tx) => {
      await this.identity(tx, guard, Permission.REDEMPTION_CODE_DELETE);
      const current = await tx.$queryRaw<RedemptionCodeReadTarget[]>(
        Prisma.sql`SELECT id,status,createTime,updateTime,${redemptionCodeRevision} AS revision FROM redemption_codes WHERE id=${target.id} AND status=1 FOR UPDATE`,
      );
      sameRedemptionCodeTargets(current, [target]);
      await guard.recheckEntries([target.id]);
      const row = await tx.redemptionCode.delete({ where: { id: target.id } });
      await this.identity(tx, guard, Permission.REDEMPTION_CODE_DELETE);
      await guard.recheckEntries([target.id]);
      return row;
    });
  }
}
