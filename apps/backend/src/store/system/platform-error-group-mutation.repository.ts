import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isErrorGroupResourceId } from "@/iam/resources/platform-error-group-resources";
import { updateErrorGroupStatusBodySchema } from "@/api/schema/system/error-report.schema";
import { ConflictError } from "@/util/errors";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import {
  PLATFORM_ERROR_GROUP_MUTATION_SELECT,
  type ErrorGroupMutationGuard,
  type PlatformErrorGroupMutationStore,
} from "./platform-error-group-mutation.store";
export class PlatformErrorGroupMutationRepository implements PlatformErrorGroupMutationStore {
  private static instance: PlatformErrorGroupMutationRepository;
  static getInstance() {
    return (this.instance ??= new PlatformErrorGroupMutationRepository());
  }
  target(id: string) {
    if (!isErrorGroupResourceId(id)) throw iamAccountDenied();
    return prisma.errorGroup.findFirst({ where: { id, status: 1 }, select: PLATFORM_ERROR_GROUP_MUTATION_SELECT });
  }
  async authorizationRevision(principal: IamPrincipal) {
    await assertIamAccountPrincipal(principal);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  private async identity(tx: Prisma.TransactionClient, guard: ErrorGroupMutationGuard) {
    await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    for (const permission of [Permission.SYSTEM_ERROR_REPORT_UPDATE, Permission.SYSTEM_ERROR_REPORT_READ]) {
      const group = await platformManagementGroupSnapshot(guard.users.principal, permission, tx);
      if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
        throw iamAccountDenied();
    }
  }
  async update(guard: ErrorGroupMutationGuard, input: Parameters<PlatformErrorGroupMutationStore["update"]>[1]) {
    const parsed = updateErrorGroupStatusBodySchema.strict().safeParse(input),
      target = guard.target;
    if (
      guard.action !== "quyan:system:error_report:UpdateErrorGroupStatus" ||
      !parsed.success ||
      !target ||
      !isErrorGroupResourceId(target.id) ||
      target.status !== 1 ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime()) ||
      typeof target.resolutionStatus !== "string" ||
      !/^[a-f0-9]{64}$/.test(guard.authorizationRevision)
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          // Range/row read locks remain held until commit, including absent future bindings.
          if (
            (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !==
            guard.authorizationRevision
          )
            throw iamAccountDenied();
          await tx.$queryRaw(Prisma.sql`SELECT id FROM error_groups WHERE id = ${target.id} FOR UPDATE`);
          const current = await tx.errorGroup.findUnique({
            where: { id: target.id },
            select: PLATFORM_ERROR_GROUP_MUTATION_SELECT,
          });
          if (
            !current ||
            current.status !== 1 ||
            current.updateTime.getTime() !== target.updateTime.getTime() ||
            current.resolutionStatus !== target.resolutionStatus
          )
            throw iamAccountDenied();
          // The compatible full-summary response is protected by GetErrorGroup as well as Update.
          const result = await tx.errorGroup.update({ where: { id: target.id }, data: parsed.data });
          await this.identity(tx, guard);
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Error group authorization or revision changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}
