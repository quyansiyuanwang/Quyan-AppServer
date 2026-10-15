import { Prisma } from "@prisma/client";
import { type Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { ConflictError } from "@/util/errors";
import type { ProbeChannelVisibilityRecord } from "./relay-probe-latest-run-read.repository";
export interface RelayProbeMutationContext {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  authorize: (resources: readonly string[]) => Promise<void>;
  authorizeAccountUnbind: (resources: readonly string[]) => Promise<void>;
  recheck: () => Promise<void>;
  visible: (channel: ProbeChannelVisibilityRecord) => Promise<boolean>;
  persist: boolean;
}
const probeMutationPolicy = Object.freeze({ timeoutMs: 30000 });
/** Lock platform membership and authorization ranges around a probe mutation. */
export async function mutatePlatformRelayProbe<T>(
  permission: Permission,
  principal: IamPrincipal,
  snapshot: PlatformManagementReadSnapshot,
  recheck: () => Promise<void>,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const identity = async () => {
          await assertIamAccountUserMutation(
            tx,
            { principal, targetUserId: principal.subjectUserId, users: snapshot.users, recheck },
            principal.subjectUserId,
          );
          await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${snapshot.group.id} FOR UPDATE`);
          const group = await platformManagementGroupSnapshot(principal, permission, tx);
          if (group.id !== snapshot.group.id || group.updateTime.getTime() !== snapshot.group.updateTime.getTime())
            throw iamAccountDenied();
        };
        await identity();
        const revision = await readIamAuthorizationRevision(tx, principal.accountOwnerId);
        const result = await mutate(tx);
        await identity();
        await recheck();
        if ((await readIamAuthorizationRevision(tx, principal.accountOwnerId)) !== revision) throw iamAccountDenied();
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: probeMutationPolicy.timeoutMs },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2034"].includes(error.code))
      throw new ConflictError("Probe mutation context changed", undefined, { messageKey: "errors.conflict" });
    throw error;
  }
}
