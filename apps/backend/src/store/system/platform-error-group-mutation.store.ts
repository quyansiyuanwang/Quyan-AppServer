import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { UpdateErrorGroupStatusRequest } from "@/api/dto/system/error-report.dto";
export const PLATFORM_ERROR_GROUP_MUTATION_SELECT = {
  id: true,
  status: true,
  updateTime: true,
  resolutionStatus: true,
} as const;
export type ErrorGroupMutationTarget = Prisma.ErrorGroupGetPayload<{
  select: typeof PLATFORM_ERROR_GROUP_MUTATION_SELECT;
}>;
export interface ErrorGroupMutationGuard {
  action: "quyan:system:error_report:UpdateErrorGroupStatus";
  target: ErrorGroupMutationTarget;
  authorizationRevision: string;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface PlatformErrorGroupMutationStore {
  target(id: string): Promise<ErrorGroupMutationTarget | null>;
  authorizationRevision(principal: IamPrincipal): Promise<string>;
  update(
    guard: ErrorGroupMutationGuard,
    input: UpdateErrorGroupStatusRequest,
  ): Promise<Prisma.ErrorGroupGetPayload<Record<string, never>>>;
}
