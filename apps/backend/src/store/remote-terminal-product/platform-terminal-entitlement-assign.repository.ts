import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isPlatformUserId } from "@/iam/resources/platform-user-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { iamAccountDenied } from "../users/iam-account-principal";
import { terminalTemplateRevision } from "./platform-terminal-template-write.repository";
import { BadRequestError, ConflictError } from "@/util/errors";
import type {
  PlatformTerminalEntitlementAssignStore,
  TerminalEntitlementAssignGuard,
} from "./platform-terminal-entitlement-assign.store";
const userSelect = { id: true, status: true, accountOwnerId: true, updateTime: true } as const;
export class PlatformTerminalEntitlementAssignRepository implements PlatformTerminalEntitlementAssignStore {
  private static instance: PlatformTerminalEntitlementAssignRepository;
  static getInstance() {
    return (this.instance ??= new PlatformTerminalEntitlementAssignRepository());
  }
  async user(principal: IamPrincipal, id: string) {
    if (!isPlatformUserId(id)) throw iamAccountDenied();
    await platformManagementGroupSnapshot(principal, Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE);
    return prisma.user.findFirst({ where: { id, status: 1 }, select: userSelect });
  }
  async template(principal: IamPrincipal, id: string) {
    if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
    await platformManagementGroupSnapshot(principal, Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE);
    return prisma.remoteTerminalProductTemplate.findFirst({ where: { id, status: { in: [0, 1] } } });
  }
  private async identity(tx: Prisma.TransactionClient, guard: TerminalEntitlementAssignGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`;
    const group = await platformManagementGroupSnapshot(
      guard.users.principal,
      Permission.REMOTE_TERMINAL_ASSIGNMENT_WRITE,
      tx,
    );
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  async create(data: Prisma.RemoteTerminalUserEntitlementUncheckedCreateInput, guard: TerminalEntitlementAssignGuard) {
    if (
      guard.operation !== "AssignEntitlement" ||
      data.id !== undefined ||
      data.userId !== guard.customer.id ||
      data.templateId !== (guard.template?.id ?? null) ||
      data.assignedBy !== guard.users.principal.subjectUserId ||
      data.status !== 1 ||
      Number(data.purchaseAmount) !== 0 ||
      data.createTime !== undefined ||
      data.updateTime !== undefined ||
      data.unbindResetAt !== undefined
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          // Serializable reads hold authorization rows/ranges through commit, including concurrent new Deny bindings.
          const revision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
          await tx.$queryRaw`SELECT id FROM users WHERE id=${guard.customer.id} FOR UPDATE`;
          const currentUser = await tx.user.findFirst({
            where: { id: guard.customer.id, status: 1 },
            select: userSelect,
          });
          if (
            !currentUser ||
            currentUser.accountOwnerId !== guard.customer.accountOwnerId ||
            currentUser.updateTime.getTime() !== guard.customer.updateTime.getTime()
          )
            throw iamAccountDenied();
          if (guard.template) {
            await tx.$queryRaw`SELECT id FROM remote_terminal_product_templates WHERE id=${guard.template.id} FOR UPDATE`;
            const current = await tx.remoteTerminalProductTemplate.findUnique({ where: { id: guard.template.id } });
            if (
              !current ||
              ![0, 1].includes(current.status) ||
              terminalTemplateRevision(current) !== terminalTemplateRevision(guard.template)
            )
              throw iamAccountDenied();
            if (current.purchaseLimitPerUser && current.purchaseLimitWindowDays) {
              const since = new Date();
              since.setDate(since.getDate() - current.purchaseLimitWindowDays);
              await tx.$queryRaw`SELECT id FROM remote_terminal_user_entitlements WHERE userId=${currentUser.id} AND templateId=${current.id} AND createTime>=${since} AND status>=0 FOR UPDATE`;
              const count = await tx.remoteTerminalUserEntitlement.count({
                where: {
                  userId: currentUser.id,
                  templateId: current.id,
                  status: { gte: 0 },
                  createTime: { gte: since },
                },
              });
              if (count >= current.purchaseLimitPerUser)
                throw new BadRequestError("Template purchase limit exceeded", undefined, {
                  messageKey: "monthlyPass.purchaseLimitExceeded",
                  messageParams: { limit: current.purchaseLimitPerUser, windowDays: current.purchaseLimitWindowDays },
                });
            }
          }
          await guard.users.recheck();
          const created = await tx.remoteTerminalUserEntitlement.create({ data });
          await this.identity(tx, guard);
          await guard.recheckEntry(created.id);
          if ((await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== revision)
            throw iamAccountDenied();
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Entitlement assignment source changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
