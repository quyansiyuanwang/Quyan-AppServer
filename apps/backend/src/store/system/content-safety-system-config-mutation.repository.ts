import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { ConflictError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { readContentSafetySystemConfiguration } from "./content-safety-system-config-snapshot";
import type {
  ContentSafetySystemConfigMutationStore,
  ContentSafetySystemConfigMutationGuard,
} from "./content-safety-system-config-mutation.store";
export class ContentSafetySystemConfigMutationRepository implements ContentSafetySystemConfigMutationStore {
  private static instance: ContentSafetySystemConfigMutationRepository;
  static getInstance() {
    return (this.instance ??= new ContentSafetySystemConfigMutationRepository());
  }
  configuration() {
    return readContentSafetySystemConfiguration(prisma);
  }
  async authorizationRevision(principal: IamPrincipal) {
    await platformManagementGroupSnapshot(principal, Permission.SYSTEM_CONFIG);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  private async identity(tx: Prisma.TransactionClient, guard: ContentSafetySystemConfigMutationGuard) {
    await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`);
    const group = await platformManagementGroupSnapshot(guard.users.principal, Permission.SYSTEM_CONFIG, tx);
    if (
      group.id !== guard.group.id ||
      group.updateTime.getTime() !== guard.group.updateTime.getTime() ||
      (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== guard.authorizationRevision
    )
      throw iamAccountDenied();
  }
  async update(updates: Readonly<Record<string, string>>, guard: ContentSafetySystemConfigMutationGuard) {
    const keys = Object.keys(updates),
      registered: readonly string[] = Object.values(CONFIG_KEYS.CONTENT_SAFETY);
    if (
      !keys.length ||
      keys.some((key) => !registered.includes(key) || typeof updates[key] !== "string") ||
      !/^[a-f0-9]{64}$/.test(guard.sourceRevision)
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          if ((await readContentSafetySystemConfiguration(tx, true)).revision !== guard.sourceRevision)
            throw iamAccountDenied();
          for (const key of keys.sort())
            await tx.serverConfig.upsert({
              where: { key },
              create: { key, value: updates[key] },
              update: { value: updates[key] },
            });
          await this.identity(tx, guard);
          return readContentSafetySystemConfiguration(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code))
        throw new ConflictError("Configuration or authorization changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
