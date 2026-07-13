import { prisma } from "@/config/database";
import type { Prisma, UserExternalIdentity } from "@prisma/client";
import type { ExternalIdentityListItem, ExternalIdentityStore } from "./external-identity.store";

export class ExternalIdentityRepository implements ExternalIdentityStore {
  private static instance: ExternalIdentityRepository;

  public static getInstance(): ExternalIdentityRepository {
    if (!ExternalIdentityRepository.instance) ExternalIdentityRepository.instance = new ExternalIdentityRepository();
    return ExternalIdentityRepository.instance;
  }

  async findByProviderIdentity(provider: string, providerUserId: string): Promise<UserExternalIdentity | null> {
    return prisma.userExternalIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
    });
  }

  async findByProviderUnionId(provider: string, providerUnionId: string): Promise<UserExternalIdentity | null> {
    return prisma.userExternalIdentity.findFirst({
      where: {
        provider,
        providerUnionId,
      },
    });
  }

  async listByUserId(userId: string): Promise<ExternalIdentityListItem[]> {
    return prisma.userExternalIdentity.findMany({
      where: {
        userId,
        revokedAt: null,
        status: { gte: 0 },
      },
      orderBy: {
        linkedAt: "desc",
      },
      select: {
        id: true,
        provider: true,
        providerUserId: true,
        providerUnionId: true,
        providerUsername: true,
        providerEmail: true,
        avatarUrl: true,
        linkedAt: true,
        lastLoginAt: true,
        lastSyncedAt: true,
        status: true,
      },
    });
  }

  async create(data: Prisma.UserExternalIdentityUncheckedCreateInput): Promise<UserExternalIdentity> {
    return prisma.userExternalIdentity.create({ data });
  }

  async updateById(id: string, data: Prisma.UserExternalIdentityUncheckedUpdateInput): Promise<UserExternalIdentity> {
    return prisma.userExternalIdentity.update({
      where: { id },
      data,
    });
  }

  async updateLastLoginById(id: string, lastLoginAt: Date): Promise<UserExternalIdentity> {
    return prisma.userExternalIdentity.update({
      where: { id },
      data: {
        lastLoginAt,
      },
    });
  }

  async findByUserIdAndProvider(userId: string, provider: string): Promise<UserExternalIdentity | null> {
    return prisma.userExternalIdentity.findFirst({
      where: {
        userId,
        provider,
        revokedAt: null,
        status: { gte: 0 },
      },
    });
  }
}