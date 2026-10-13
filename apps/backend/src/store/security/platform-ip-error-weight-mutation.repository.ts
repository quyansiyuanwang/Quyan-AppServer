import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { platformIpAddressIdentifier } from "@/iam/resources/platform-ip-address-resources";
import { ConflictError, InternalServerError } from "@/util/errors";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import type {
  IpErrorWeightMutationGuard,
  PlatformIpErrorWeightMutationStore,
} from "./platform-ip-error-weight-mutation.store";
export class PlatformIpErrorWeightMutationRepository implements PlatformIpErrorWeightMutationStore {
  private static instance: PlatformIpErrorWeightMutationRepository;
  static getInstance() {
    return (this.instance ??= new PlatformIpErrorWeightMutationRepository());
  }
  async authorizationRevision(principal: IamPrincipal) {
    await assertIamAccountPrincipal(principal);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  async admit(guard: IpErrorWeightMutationGuard, effect: () => Promise<void>): Promise<void> {
    if (
      ![
        "quyan:system:ip_blacklist:SetIPAddressErrorWeight",
        "quyan:system:ip_blacklist:ResetIPAddressErrorWeight",
      ].includes(guard.action) ||
      !platformIpAddressIdentifier(guard.ipAddress) ||
      !guard.group ||
      !(guard.group.updateTime instanceof Date) ||
      !Number.isFinite(guard.group.updateTime.getTime()) ||
      !/^[a-f0-9]{64}$/.test(guard.authorizationRevision)
    )
      throw iamAccountDenied();
    let effectStarted = false;
    try {
      await prisma.$transaction(
        async (tx) => {
          await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
          const group = await platformManagementGroupSnapshot(
            guard.users.principal,
            Permission.IP_BLACKLIST_UPDATE,
            tx,
          );
          if (
            group.id !== guard.group.id ||
            group.updateTime.getTime() !== guard.group.updateTime.getTime() ||
            (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !==
              guard.authorizationRevision
          )
            throw iamAccountDenied();
          // Admission ends here: IAM/identity locks remain held through the single confirmed external effect.
          await guard.users.recheck();
          effectStarted = true;
          await effect();
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (effectStarted) {
        if (error instanceof InternalServerError) throw error;
        throw new InternalServerError("Admitted IP weight write could not be confirmed", undefined, {
          messageKey: "ipBlacklist.weightMutationUnavailable",
        });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("IP weight admission snapshot changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
