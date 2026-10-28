import { createHash } from "node:crypto";
import { Prisma, type RemoteTerminalUserEntitlement } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isRemoteTerminalId } from "@/iam/resources/remote-terminal-resources";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { terminalTemplateRevision } from "./platform-terminal-template-write.repository";
import { chargeTerminalPurchase } from "./terminal-purchase-charge";
import { BadRequestError, ConflictError } from "@/util/errors";
import type { TerminalPurchaseStore, TerminalPurchaseData, TerminalPurchaseGuard } from "./terminal-purchase.store";
export function terminalPurchaseTargetRevision(row: RemoteTerminalUserEntitlement) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(row)
          .sort()
          .map((key) => [key, row[key as keyof typeof row]]),
      ),
    )
    .digest("hex");
}
export class TerminalPurchaseRepository implements TerminalPurchaseStore {
  private static instance: TerminalPurchaseRepository;
  static getInstance() {
    return (this.instance ??= new TerminalPurchaseRepository());
  }
  async template(principal: IamPrincipal, id: string) {
    if (!isRemoteTerminalId(id)) throw iamAccountDenied();
    await assertIamAccountPrincipal(principal);
    return prisma.remoteTerminalProductTemplate.findFirst({ where: { id, status: 1, publishStatus: "published" } });
  }
  async target(principal: IamPrincipal, id: string) {
    if (!isRemoteTerminalId(id)) throw iamAccountDenied();
    await assertIamAccountPrincipal(principal);
    return prisma.remoteTerminalUserEntitlement.findFirst({
      where: { id, userId: principal.subjectUserId, status: 1 },
    });
  }
  async purchase(data: TerminalPurchaseData, guard: TerminalPurchaseGuard) {
    const userId = guard.users.principal.subjectUserId,
      fields = data.entitlement;
    if (
      guard.users.targetUserId !== userId ||
      !Number.isFinite(data.chargeAmount) ||
      data.chargeAmount < 0 ||
      fields.id !== undefined ||
      fields.assignedBy !== userId ||
      fields.status !== 1 ||
      fields.createTime !== undefined ||
      fields.updateTime !== undefined ||
      (data.kind === "create" &&
        (guard.target !== null || fields.userId !== userId || fields.templateId !== guard.template.id)) ||
      (data.kind === "renew" &&
        (!guard.target ||
          guard.target.userId !== userId ||
          guard.target.templateId !== guard.template.id ||
          fields.userId !== undefined ||
          fields.templateId !== undefined))
    )
      throw iamAccountDenied();
    const priorAmount = data.kind === "renew" ? (guard.target!.purchaseAmount ?? 0) : 0;
    if (!new Decimal(String(fields.purchaseAmount)).equals(new Decimal(priorAmount).plus(data.chargeAmount)))
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await assertIamAccountUserMutation(tx, guard.users, userId);
          const revision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
          await tx.$queryRaw`SELECT id FROM remote_terminal_product_templates WHERE id=${guard.template.id} FOR UPDATE`;
          const template = await tx.remoteTerminalProductTemplate.findUnique({ where: { id: guard.template.id } });
          if (
            !template ||
            template.status !== 1 ||
            template.publishStatus !== "published" ||
            terminalTemplateRevision(template) !== terminalTemplateRevision(guard.template)
          )
            throw iamAccountDenied();
          if (data.kind === "renew") {
            await tx.$queryRaw`SELECT id FROM remote_terminal_user_entitlements WHERE id=${guard.target!.id} FOR UPDATE`;
            const target = await tx.remoteTerminalUserEntitlement.findFirst({
              where: { id: guard.target!.id, userId, status: 1, templateId: template.id },
            });
            if (!target || terminalPurchaseTargetRevision(target) !== terminalPurchaseTargetRevision(guard.target!))
              throw iamAccountDenied();
            await guard.recheckEntry(target.id);
          } else if (template.purchaseLimitPerUser && template.purchaseLimitWindowDays) {
            const since = new Date();
            since.setDate(since.getDate() - template.purchaseLimitWindowDays);
            await tx.$queryRaw`SELECT id FROM remote_terminal_user_entitlements WHERE userId=${userId} AND templateId=${template.id} AND createTime>=${since} AND status>=0 FOR UPDATE`;
            const count = await tx.remoteTerminalUserEntitlement.count({
              where: { userId, templateId: template.id, status: { gte: 0 }, createTime: { gte: since } },
            });
            if (count >= template.purchaseLimitPerUser)
              throw new BadRequestError("Template purchase limit exceeded", undefined, {
                messageKey: "monthlyPass.purchaseLimitExceeded",
                messageParams: { limit: template.purchaseLimitPerUser, windowDays: template.purchaseLimitWindowDays },
              });
          }
          await guard.users.recheck();
          await chargeTerminalPurchase(tx, { userId, purchaseAmount: data.chargeAmount, templateName: template.name });
          const record =
            data.kind === "create"
              ? await tx.remoteTerminalUserEntitlement.create({ data: data.entitlement })
              : await tx.remoteTerminalUserEntitlement.update({
                  where: { id: guard.target!.id },
                  data: data.entitlement,
                });
          await assertIamAccountUserMutation(tx, guard.users, userId);
          await guard.recheckEntry(record.id);
          if ((await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== revision)
            throw iamAccountDenied();
          return record;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("Terminal purchase source changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
