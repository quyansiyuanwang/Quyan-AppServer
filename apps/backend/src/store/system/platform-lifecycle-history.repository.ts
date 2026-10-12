import { prisma } from "@/config/database";
import { Permission, type IamPrincipal } from "@quyan/shared";
import type { Prisma } from "@prisma/client";
import { DATA_LIFECYCLE_DATASETS } from "@/constant/data-maintenance-datasets";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isCanonicalLifecycleId, isLifecycleDataset } from "@/iam/resources/platform-lifecycle-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import {
  LIFECYCLE_RUN_TARGET_SELECT,
  LIFECYCLE_ARTIFACT_TARGET_SELECT,
  LIFECYCLE_RUN_VIEW_SELECT,
  LIFECYCLE_ARTIFACT_VIEW_SELECT,
} from "./platform-lifecycle-history.store";
import type {
  PlatformLifecycleHistoryStore,
  LifecycleRunTarget,
  LifecycleArtifactTarget,
  PlatformLifecycleDownloadStore,
} from "./platform-lifecycle-history.store";
export class PlatformLifecycleHistoryRepository
  implements PlatformLifecycleHistoryStore, PlatformLifecycleDownloadStore
{
  private static instance: PlatformLifecycleHistoryRepository;
  static getInstance() {
    return (this.instance ??= new PlatformLifecycleHistoryRepository());
  }
  private async actor(principal: IamPrincipal) {
    await platformManagementGroupSnapshot(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE);
  }
  private after(after?: string) {
    if (after !== undefined && !isCanonicalLifecycleId(after)) throw iamAccountDenied();
    return after === undefined ? {} : { id: { gt: after } };
  }
  private runsWhere(targets: readonly LifecycleRunTarget[]): Prisma.DataLifecycleRunWhereInput {
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      targets.some((t) => !isCanonicalLifecycleId(t.id) || t.status !== 1 || !isLifecycleDataset(t.dataset))
    )
      throw iamAccountDenied();
    return { status: 1, OR: targets.map((t) => ({ id: t.id, dataset: t.dataset, updateTime: t.updateTime })) };
  }
  private artifactsWhere(
    run: LifecycleRunTarget,
    targets?: readonly LifecycleArtifactTarget[],
  ): Prisma.ArchiveArtifactWhereInput {
    if (
      !isCanonicalLifecycleId(run.id) ||
      run.status !== 1 ||
      !isLifecycleDataset(run.dataset) ||
      (targets &&
        (targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
          targets.some(
            (t) =>
              !isCanonicalLifecycleId(t.id) ||
              t.status !== 1 ||
              t.lifecycleRunId !== run.id ||
              t.dataset !== run.dataset,
          )))
    )
      throw iamAccountDenied();
    return {
      status: 1,
      lifecycleRunId: run.id,
      dataset: run.dataset,
      lifecycleRun: { id: run.id, status: 1, dataset: run.dataset, updateTime: run.updateTime },
      ...(targets ? { OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime })) } : {}),
    };
  }
  async targetDownload(principal: IamPrincipal, id: string) {
    await this.actor(principal);
    if (!isCanonicalLifecycleId(id)) throw iamAccountDenied();
    const target = await prisma.archiveArtifact.findFirst({
      where: {
        id,
        status: 1,
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        lifecycleRun: { status: 1 },
      },
      select: { ...LIFECYCLE_ARTIFACT_TARGET_SELECT, lifecycleRun: { select: LIFECYCLE_RUN_TARGET_SELECT } },
    });
    if (target && (!isLifecycleDataset(target.dataset) || target.dataset !== target.lifecycleRun.dataset))
      throw iamAccountDenied();
    return target;
  }
  async scanRuns(principal: IamPrincipal, after?: string) {
    await this.actor(principal);
    return prisma.dataLifecycleRun.findMany({
      where: { status: 1, dataset: { in: [...DATA_LIFECYCLE_DATASETS] }, ...this.after(after) },
      select: LIFECYCLE_RUN_TARGET_SELECT,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async targetRun(principal: IamPrincipal, id: string) {
    await this.actor(principal);
    if (!isCanonicalLifecycleId(id)) throw iamAccountDenied();
    return prisma.dataLifecycleRun.findFirst({
      where: { id, status: 1, dataset: { in: [...DATA_LIFECYCLE_DATASETS] } },
      select: LIFECYCLE_RUN_TARGET_SELECT,
    });
  }
  async checkRuns(principal: IamPrincipal, targets: readonly LifecycleRunTarget[]) {
    await this.actor(principal);
    if (!targets.length) return [];
    return prisma.dataLifecycleRun.findMany({ where: this.runsWhere(targets), select: LIFECYCLE_RUN_TARGET_SELECT });
  }
  async hydrateRuns(principal: IamPrincipal, targets: readonly LifecycleRunTarget[]) {
    await this.actor(principal);
    if (!targets.length) return [];
    return prisma.dataLifecycleRun.findMany({ where: this.runsWhere(targets), select: LIFECYCLE_RUN_VIEW_SELECT });
  }
  async scanArtifacts(principal: IamPrincipal, run: LifecycleRunTarget, after?: string) {
    await this.actor(principal);
    return prisma.archiveArtifact.findMany({
      where: { ...this.artifactsWhere(run), ...this.after(after) },
      select: LIFECYCLE_ARTIFACT_TARGET_SELECT,
      orderBy: { id: "asc" },
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async checkArtifacts(principal: IamPrincipal, run: LifecycleRunTarget, targets: readonly LifecycleArtifactTarget[]) {
    await this.actor(principal);
    if (!targets.length) return [];
    return prisma.archiveArtifact.findMany({
      where: this.artifactsWhere(run, targets),
      select: LIFECYCLE_ARTIFACT_TARGET_SELECT,
    });
  }
  async hydrateArtifacts(
    principal: IamPrincipal,
    run: LifecycleRunTarget,
    targets: readonly LifecycleArtifactTarget[],
  ) {
    await this.actor(principal);
    if (!targets.length) return [];
    return prisma.archiveArtifact.findMany({
      where: this.artifactsWhere(run, targets),
      select: LIFECYCLE_ARTIFACT_VIEW_SELECT,
    });
  }
}
