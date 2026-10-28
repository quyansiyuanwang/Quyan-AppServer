import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { assertIamAccountUserMutation, type IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { monthlyPassTemplateRevision } from "./monthly-pass-template-write";
import { ConflictError } from "@/util/errors";
import type { MonthlyPassTemplateWithQuotaWindows, MonthlyPassQuotaWindowInput } from "./monthly-pass.store";
export interface MonthlyPassPurchaseCharge {
  userId: string;
  purchaseAmount: number;
  templateName: string;
  templateId: string;
  limit?: { maximum: number; windowStart: Date };
}
export interface MonthlyPassPurchaseGuard {
  template: MonthlyPassTemplateWithQuotaWindows;
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
  quote?: Readonly<{ revision: string; recheck: () => Promise<void> }>;
}
export function monthlyPassPurchaseRevision(
  data: Prisma.UserMonthlyPassUncheckedCreateInput,
  windows: readonly MonthlyPassQuotaWindowInput[],
  purchase: MonthlyPassPurchaseCharge,
) {
  const fields = (value: object) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256")
    .update(
      JSON.stringify([
        fields(data),
        windows.map(fields),
        fields(purchase),
        purchase.limit ? fields(purchase.limit) : undefined,
      ]),
    )
    .digest("hex");
}
/** Bind a server-computed quote and entitlement to the exact inputs passed to the charging transaction. */
export function bindMonthlyPassPurchaseQuote(
  guard: MonthlyPassPurchaseGuard,
  data: Prisma.UserMonthlyPassUncheckedCreateInput,
  windows: readonly MonthlyPassQuotaWindowInput[],
  purchase: MonthlyPassPurchaseCharge,
  recheck: () => Promise<void>,
) {
  if (guard.quote) throw iamAccountDenied();
  guard.quote = Object.freeze({ revision: monthlyPassPurchaseRevision(data, windows, purchase), recheck });
}
export async function runMonthlyPassPurchase<T extends { id: string }>(
  guard: MonthlyPassPurchaseGuard | undefined,
  data: Prisma.UserMonthlyPassUncheckedCreateInput,
  windows: readonly MonthlyPassQuotaWindowInput[],
  purchase: MonthlyPassPurchaseCharge,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  if (!guard) return prisma.$transaction(mutate);
  const userId = guard.users.principal.subjectUserId;
  if (
    !guard.quote ||
    guard.quote.revision !== monthlyPassPurchaseRevision(data, windows, purchase) ||
    guard.users.targetUserId !== userId ||
    data.userId !== userId ||
    purchase.userId !== userId ||
    data.templateId !== guard.template.id ||
    purchase.templateId !== guard.template.id ||
    purchase.templateName !== guard.template.name ||
    data.assignedBy !== userId ||
    data.status !== 1 ||
    Number(data.usedQuota) !== 0 ||
    !Number.isFinite(Number(data.totalQuota)) ||
    Number(data.totalQuota) <= 0 ||
    Number(data.remainingQuota) !== Number(data.totalQuota) ||
    !Number.isFinite(purchase.purchaseAmount) ||
    purchase.purchaseAmount < 0 ||
    ["id", "createTime", "updateTime", "quotaWindows"].some((key) => Object.hasOwn(data, key))
  )
    throw iamAccountDenied();
  try {
    return await prisma.$transaction(
      async (tx) => {
        await assertIamAccountUserMutation(tx, guard.users, userId);
        const revision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
        await tx.$queryRaw`SELECT id FROM monthly_pass_templates WHERE id=${guard.template.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM monthly_pass_template_quota_windows WHERE monthlyPassTemplateId=${guard.template.id} ORDER BY id FOR UPDATE`;
        const template = await tx.monthlyPassTemplate.findUnique({
          where: { id: guard.template.id },
          include: { quotaWindows: true },
        });
        if (
          !template ||
          template.status !== 1 ||
          template.publishStatus !== "published" ||
          !template.allowBalanceRedemption ||
          monthlyPassTemplateRevision(template) !== monthlyPassTemplateRevision(guard.template)
        )
          throw iamAccountDenied();
        await guard.quote!.recheck();
        const result = await mutate(tx);
        await assertIamAccountUserMutation(tx, guard.users, userId);
        await guard.recheckEntry(result.id);
        await guard.quote!.recheck();
        if ((await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== revision)
          throw iamAccountDenied();
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
      throw new ConflictError("Monthly pass purchase source changed", undefined, { messageKey: "errors.conflict" });
    throw error;
  }
}
