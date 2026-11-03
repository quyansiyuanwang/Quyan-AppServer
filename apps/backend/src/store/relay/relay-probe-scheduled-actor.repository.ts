import { prisma, disconnectDatabase } from "@/config/database";
import type { IamPrincipal } from "@quyan/shared";
import { iamAccountDenied } from "../users/iam-account-principal";

export class RelayProbeScheduledActorRepository {
  private static instance: RelayProbeScheduledActorRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeScheduledActorRepository());
  }
  closeInitializationConnection() {
    return disconnectDatabase();
  }
  initializationAccount(username: string) {
    return prisma.user.findUnique({
      where: { username },
      select: { id: true, status: true, email: true, accountOwnerId: true },
    });
  }

  async principal(userId: string): Promise<IamPrincipal> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, accountOwnerId: true },
    });
    if (!user || user.status !== 1) throw iamAccountDenied();
    const ownerId = user.accountOwnerId ?? user.id;
    return {
      subjectUserId: user.id,
      principalUserId: user.id,
      accountOwnerId: ownerId,
      subjectType: ownerId === user.id ? "root" : "sub_user",
    };
  }
}
