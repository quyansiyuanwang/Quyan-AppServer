import type { IamPrincipal } from "@quyan/shared";
import type { PasskeyCredential, Prisma } from "@prisma/client";
import type { PasskeyCredentialItem } from "@/api/dto/users/passkey.dto";
export type PasskeyTarget = Pick<PasskeyCredential, "id" | "userId" | "createTime" | "updateTime">;
export interface PasskeyActorSnapshot {
  id: string;
  username: string;
  name: string | null;
  updateTime: Date;
  ownerUpdateTime: Date;
}
export interface PasskeyManagementStore {
  actor(principal: IamPrincipal): Promise<PasskeyActorSnapshot>;
  scan(principal: IamPrincipal, after?: PasskeyTarget): Promise<PasskeyTarget[]>;
  target(principal: IamPrincipal, credentialId: string): Promise<PasskeyTarget | null>;
  hydrate(principal: IamPrincipal, targets: readonly PasskeyTarget[]): Promise<PasskeyCredentialItem[]>;
  create(
    principal: IamPrincipal,
    actor: PasskeyActorSnapshot,
    data: Prisma.PasskeyCredentialUncheckedCreateInput,
  ): Promise<void>;
  revoke(principal: IamPrincipal, target: PasskeyTarget): Promise<void>;
}
