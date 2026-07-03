import { prisma } from "@/config/database";
import type { PasskeyCredential, Prisma } from "@prisma/client";
import type { PasskeyCredentialRegView, PasskeyCredentialStore } from "./passkey-credential.store";

export type { PasskeyCredentialRegView } from "./passkey-credential.store";

export class PasskeyCredentialRepository implements PasskeyCredentialStore {
  private static instance: PasskeyCredentialRepository;

  public static getInstance(): PasskeyCredentialRepository {
    if (!PasskeyCredentialRepository.instance) PasskeyCredentialRepository.instance = new PasskeyCredentialRepository();

    return PasskeyCredentialRepository.instance;
  }

  async findRegistrationViewByUserId(userId: string): Promise<PasskeyCredentialRegView[]> {
    return prisma.passkeyCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });
  }

  async create(data: Prisma.PasskeyCredentialUncheckedCreateInput): Promise<PasskeyCredential> {
    return prisma.passkeyCredential.create({ data });
  }

  async findByCredentialId(credentialId: string): Promise<PasskeyCredential | null> {
    return prisma.passkeyCredential.findUnique({
      where: { credentialId },
    });
  }

  async updateCounter(credentialId: string, counter: bigint): Promise<PasskeyCredential> {
    return prisma.passkeyCredential.update({
      where: { credentialId },
      data: { counter },
    });
  }

  async listByUserId(userId: string): Promise<PasskeyCredential[]> {
    return prisma.passkeyCredential.findMany({
      where: { userId },
      orderBy: { createTime: "desc" },
    });
  }

  async deleteByCredentialId(credentialId: string): Promise<PasskeyCredential> {
    return prisma.passkeyCredential.delete({
      where: { credentialId },
    });
  }
}
