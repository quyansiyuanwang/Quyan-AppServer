import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { activeIamAccountUsers, assertIamAccountPrincipal, iamAccountDenied } from "./iam-account-principal";

export interface IamAccountUserMutationGuard {
  principal: IamPrincipal;
  targetUserId: string;
  users: readonly { id: string; updateTime: Date }[];
  recheck: () => Promise<void>;
}

/** Lock trusted identities before any money write and reject a stale authorization snapshot. */
export async function assertIamAccountUserMutation(
  tx: Prisma.TransactionClient,
  guard: IamAccountUserMutationGuard,
  userId: string,
) {
  const required = [...new Set([guard.principal.subjectUserId, guard.principal.accountOwnerId, userId])].sort();
  if (
    guard.targetUserId !== userId ||
    guard.users.length !== required.length ||
    required.some(
      (id) =>
        !guard.users.some(
          (row) => row.id === id && row.updateTime instanceof Date && Number.isFinite(row.updateTime.getTime()),
        ),
    )
  )
    throw iamAccountDenied();
  await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(required)}) ORDER BY id FOR UPDATE`);
  await assertIamAccountPrincipal(guard.principal, tx);
  const current = await tx.user.findMany({
    where: { ...activeIamAccountUsers(guard.principal.accountOwnerId), id: { in: required } },
    select: { id: true, updateTime: true },
  });
  if (
    current.length !== required.length ||
    guard.users.some(
      (expected) =>
        !current.some((row) => row.id === expected.id && row.updateTime.getTime() === expected.updateTime.getTime()),
    )
  )
    throw iamAccountDenied();
  await guard.recheck();
}
