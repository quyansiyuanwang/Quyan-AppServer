import type { Prisma, UserExternalIdentity } from "@prisma/client";

export type ExternalIdentityListItem = Prisma.UserExternalIdentityGetPayload<{
  select: {
    id: true;
    provider: true;
    providerUserId: true;
    providerUnionId: true;
    providerUsername: true;
    providerEmail: true;
    avatarUrl: true;
    linkedAt: true;
    lastLoginAt: true;
    lastSyncedAt: true;
    status: true;
  };
}>;

export interface ExternalIdentityStore {
  findByProviderIdentity(provider: string, providerUserId: string): Promise<UserExternalIdentity | null>;
  findByProviderUnionId(provider: string, providerUnionId: string): Promise<UserExternalIdentity | null>;
  listByUserId(userId: string): Promise<ExternalIdentityListItem[]>;
  create(data: Prisma.UserExternalIdentityUncheckedCreateInput): Promise<UserExternalIdentity>;
  updateById(id: string, data: Prisma.UserExternalIdentityUncheckedUpdateInput): Promise<UserExternalIdentity>;
  updateLastLoginById(id: string, lastLoginAt: Date): Promise<UserExternalIdentity>;
  findByUserIdAndProvider(userId: string, provider: string): Promise<UserExternalIdentity | null>;
}