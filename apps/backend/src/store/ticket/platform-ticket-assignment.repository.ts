import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { ConflictError } from "@/util/errors";
import type {
  PlatformTicketAssignmentStore,
  TicketAssignmentTarget,
  TicketAssignmentWriteGuard,
} from "./platform-ticket-assignment.store";
const key = CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES,
  permission = Permission.TICKET_REVIEW_UPDATE;
const revision = Prisma.sql`SHA2(CAST(JSON_ARRAY(id,status,\`key\`,value,createTime,updateTime) AS CHAR),256)`;
export function sameTicketAssignmentTarget(
  current: TicketAssignmentTarget | null,
  expected: TicketAssignmentTarget | null,
) {
  if (current === null || expected === null) return current === expected;
  return (
    current.id === expected.id &&
    current.status === 1 &&
    expected.status === 1 &&
    typeof current.revision === "string" &&
    /^[a-f0-9]{64}$/.test(current.revision) &&
    current.revision === expected.revision &&
    current.createTime instanceof Date &&
    expected.createTime instanceof Date &&
    current.updateTime instanceof Date &&
    expected.updateTime instanceof Date &&
    Number.isFinite(current.createTime.getTime()) &&
    current.createTime.getTime() === expected.createTime.getTime() &&
    Number.isFinite(current.updateTime.getTime()) &&
    current.updateTime.getTime() === expected.updateTime.getTime()
  );
}
export class PlatformTicketAssignmentRepository implements PlatformTicketAssignmentStore {
  private static instance: PlatformTicketAssignmentRepository;
  static getInstance() {
    return (this.instance ??= new PlatformTicketAssignmentRepository());
  }
  private actor(principal: IamPrincipal, tx: Prisma.TransactionClient = prisma) {
    return platformManagementGroupSnapshot(principal, permission, tx);
  }
  private async metadata(tx: Prisma.TransactionClient = prisma, lock = false) {
    const rows = await tx.$queryRaw<TicketAssignmentTarget[]>(
      Prisma.sql`SELECT id,status,createTime,updateTime,${revision} AS revision FROM server_configs WHERE \`key\`=${key} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
    const row = rows[0] ?? null;
    if (row && !sameTicketAssignmentTarget(row, row)) throw iamAccountDenied();
    return row;
  }
  async target(principal: IamPrincipal) {
    await this.actor(principal);
    return this.metadata();
  }
  async hydrate(principal: IamPrincipal, target: TicketAssignmentTarget | null) {
    return prisma.$transaction(
      async (tx) => {
        await this.actor(principal, tx);
        if (!sameTicketAssignmentTarget(await this.metadata(tx, true), target)) throw iamAccountDenied();
        const row = await tx.serverConfig.findUnique({ where: { key }, select: { value: true } });
        await this.actor(principal, tx);
        return row?.value ?? null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async authorizationRevision(principal: IamPrincipal) {
    await this.actor(principal);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  private async identity(tx: Prisma.TransactionClient, guard: TicketAssignmentWriteGuard) {
    if (!guard.group || !/^[a-f0-9]{64}$/.test(guard.authorizationRevision)) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`);
    const current = await this.actor(guard.users.principal, tx);
    if (
      current.id !== guard.group.id ||
      current.updateTime.getTime() !== guard.group.updateTime.getTime() ||
      (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== guard.authorizationRevision
    )
      throw iamAccountDenied();
  }
  async update(value: string, target: TicketAssignmentTarget | null, guard: TicketAssignmentWriteGuard) {
    try {
      await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          if (!sameTicketAssignmentTarget(await this.metadata(tx, true), target)) throw iamAccountDenied();
          await tx.serverConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
          await this.identity(tx, guard);
          await guard.users.recheck();
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Assignment configuration or authorization context changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}
