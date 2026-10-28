import type { DeveloperProductConfig } from "@prisma/client";
import type { DeveloperProductCode, IamPrincipal, Permission } from "@quyan/shared";
import type { UpdateDeveloperProductConfigDto } from "@/api/dto/developer/product-platform.dto";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export type DeveloperConfigWriteTarget = Pick<DeveloperProductConfig, "id" | "productCode" | "status" | "updateTime">;
export interface PlatformDeveloperConfigWriteGuard {
  permission: Permission;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
}
export interface PlatformDeveloperConfigWriteStore {
  target(principal: IamPrincipal, product: DeveloperProductCode): Promise<DeveloperConfigWriteTarget | null>;
  upsert(
    product: DeveloperProductCode,
    body: UpdateDeveloperProductConfigDto,
    target: DeveloperConfigWriteTarget | null,
    guard: PlatformDeveloperConfigWriteGuard,
  ): Promise<DeveloperProductConfig>;
}
