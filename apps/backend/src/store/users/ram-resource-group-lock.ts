import type { Prisma } from "@prisma/client";
import { AccountStatus } from "@/util/auth/account-status";
import { ForbiddenError } from "@/util/errors";
/** All membership and authorization changes serialize on the same group revision. */
export async function lockRamResourceGroup(
  tx: Prisma.TransactionClient,
  id: string,
  expectedUpdateTime?: Date,
): Promise<void> {
  const group = await tx.ramResourceGroup.findFirst({ where: { id, status: AccountStatus.ACTIVE } });
  if (!group || (expectedUpdateTime && group.updateTime.getTime() !== expectedUpdateTime.getTime()))
    throw new ForbiddenError("Resource group changed during authorization", undefined, {
      messageKey: "iam.versionConflict",
    });
  const changed = await tx.ramResourceGroup.updateMany({
    where: { id, status: AccountStatus.ACTIVE, updateTime: group.updateTime },
    data: { updateTime: new Date(Math.max(Date.now(), group.updateTime.getTime() + 1)) },
  });
  if (changed.count !== 1)
    throw new ForbiddenError("Resource group revision conflict", undefined, { messageKey: "iam.versionConflict" });
}
