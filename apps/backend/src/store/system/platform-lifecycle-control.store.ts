import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
export const LIFECYCLE_POLICY_TARGET_SELECT = { id: true, dataset: true, status: true, updateTime: true } as const;
export const LIFECYCLE_SCHEDULE_TARGET_SELECT = { id: true, key: true, status: true, updateTime: true } as const;
export type LifecyclePolicyTarget = Prisma.DataLifecyclePolicyGetPayload<{
  select: typeof LIFECYCLE_POLICY_TARGET_SELECT;
}>;
export type LifecycleScheduleTarget = Prisma.ServerConfigGetPayload<{
  select: typeof LIFECYCLE_SCHEDULE_TARGET_SELECT;
}>;
export type LifecycleControlAction =
  | "quyan:system:data_lifecycle:UpdatePolicy"
  | "quyan:system:data_lifecycle:UpdateSchedule";
export interface LifecycleControlGuard {
  action: LifecycleControlAction;
  dataset?: string;
  policy?: LifecyclePolicyTarget;
  configs: readonly LifecycleScheduleTarget[];
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
}
export interface PlatformLifecycleControlStore {
  policyTarget(principal: IamPrincipal, dataset: string): Promise<LifecyclePolicyTarget | null>;
  scheduleTargets(principal: IamPrincipal): Promise<LifecycleScheduleTarget[]>;
  updatePolicy(
    guard: LifecycleControlGuard,
    input: { enabled: boolean; hotRetentionDays: number },
  ): Promise<Prisma.DataLifecyclePolicyGetPayload<Record<string, never>>>;
  updateSchedule(guard: LifecycleControlGuard, input: { enabled: boolean; time: string }): Promise<void>;
}
