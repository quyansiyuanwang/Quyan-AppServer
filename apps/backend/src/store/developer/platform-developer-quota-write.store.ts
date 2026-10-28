import type { DeveloperQuotaOverride } from "@prisma/client";
import type { Permission, IamPrincipal } from "@quyan/shared";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type { UpsertDeveloperQuotaOverrideDto } from "@/api/dto/developer/developer.dto";
export type DeveloperQuotaWriteTarget = Pick<
  DeveloperQuotaOverride,
  "id" | "subjectType" | "subjectId" | "service" | "status" | "updateTime"
>;
export interface DeveloperQuotaSubjectSnapshot {
  subjectType: "user" | "project";
  subjectId: string;
  service: string;
  users: readonly { id: string; updateTime: Date; accountOwnerId: string | null }[];
  project?: { id: string; userId: string; updateTime: Date };
}
export interface DeveloperQuotaWritePreparation {
  subject: DeveloperQuotaSubjectSnapshot;
  target: DeveloperQuotaWriteTarget | null;
}
export interface PlatformDeveloperQuotaWriteGuard {
  permission: Permission;
  group: { id: string; updateTime: Date };
  users: IamAccountUserMutationGuard;
  recheckEntry: (id: string) => Promise<void>;
}
export interface PlatformDeveloperQuotaWriteStore {
  prepare(principal: IamPrincipal, body: UpsertDeveloperQuotaOverrideDto): Promise<DeveloperQuotaWritePreparation>;
  target(principal: IamPrincipal, id: string): Promise<DeveloperQuotaWriteTarget | null>;
  upsert(
    body: UpsertDeveloperQuotaOverrideDto,
    preparation: DeveloperQuotaWritePreparation,
    guard: PlatformDeveloperQuotaWriteGuard,
  ): Promise<DeveloperQuotaOverride>;
  remove(target: DeveloperQuotaWriteTarget, guard: PlatformDeveloperQuotaWriteGuard): Promise<DeveloperQuotaOverride>;
}
