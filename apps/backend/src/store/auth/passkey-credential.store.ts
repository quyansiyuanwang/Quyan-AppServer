import type { PasskeyCredential, Prisma } from "@prisma/client";

export type PasskeyCredentialRegView = Prisma.PasskeyCredentialGetPayload<{
  select: { credentialId: true; transports: true };
}>;

export type PasskeyCredentialPublicView = Pick<
  PasskeyCredential,
  "id" | "credentialId" | "name" | "deviceType" | "backedUp" | "createTime"
>;
export interface PasskeyCredentialStore {
  findRegistrationViewByUserId(userId: string): Promise<PasskeyCredentialRegView[]>;
  create(data: Prisma.PasskeyCredentialUncheckedCreateInput): Promise<PasskeyCredential>;
  findByCredentialId(credentialId: string): Promise<PasskeyCredential | null>;
  updateCounter(credentialId: string, counter: bigint): Promise<PasskeyCredential>;
  listByUserId(userId: string): Promise<PasskeyCredentialPublicView[]>;
  deleteByCredentialId(credentialId: string): Promise<PasskeyCredential>;
}
