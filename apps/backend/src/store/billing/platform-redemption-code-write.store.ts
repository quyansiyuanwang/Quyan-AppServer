import type { RedemptionCode } from "@prisma/client";
import type { IamPrincipal, Permission } from "@quyan/shared";
import type { CreateRedemptionCodeDto } from "@/api/dto/billing/redemption-code.dto";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { RedemptionCodeReadTarget } from "./platform-redemption-code-read.store";
export interface RedemptionCodeWriteGuard {
  permission: Permission;
  group: { id: string; updateTime: Date };
  authorizationRevision: string;
  users: IamAccountUserMutationGuard;
  recheckEntries(ids: readonly string[]): Promise<void>;
}
export interface PlatformRedemptionCodeWriteStore {
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  target(principal: IamPrincipal, id: string): Promise<RedemptionCodeReadTarget | null>;
  create(input: CreateRedemptionCodeDto, guard: RedemptionCodeWriteGuard): Promise<RedemptionCode[]>;
  remove(target: RedemptionCodeReadTarget, guard: RedemptionCodeWriteGuard): Promise<RedemptionCode>;
}
