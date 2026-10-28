import type { DeveloperProductEntitlement } from "@prisma/client";
import type { DeveloperProductCode, IamPrincipal, Permission } from "@quyan/shared";
import type { UpdateDeveloperProductAccountDto } from "@/api/dto/developer/product-platform.dto";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { DeveloperAccountReadRow } from "./platform-developer-account-read.store";
export type DeveloperAccountWriteTarget = Pick<
  DeveloperProductEntitlement,
  "id" | "productCode" | "accountOwnerId" | "status" | "updateTime"
>;
export interface DeveloperAccountWritePreparation {
  owner: { id: string; status: number; userType: string; accountOwnerId: string | null; updateTime: Date };
  config: { id: string; productCode: string; status: number; updateTime: Date };
  target: DeveloperAccountWriteTarget | null;
}
export interface PlatformDeveloperAccountWriteGuard {
  permission: Permission;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
}
export interface PlatformDeveloperAccountWriteStore {
  prepare(
    principal: IamPrincipal,
    product: DeveloperProductCode,
    ownerId: string,
  ): Promise<DeveloperAccountWritePreparation>;
  upsert(
    product: DeveloperProductCode,
    ownerId: string,
    body: UpdateDeveloperProductAccountDto,
    preparation: DeveloperAccountWritePreparation,
    guard: PlatformDeveloperAccountWriteGuard,
  ): Promise<DeveloperAccountReadRow>;
}
