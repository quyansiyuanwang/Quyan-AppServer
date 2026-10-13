import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isLifecycleDataset } from "@/iam/resources/platform-lifecycle-resources";
import { ConflictError } from "@/util/errors";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { ObservabilityRepository } from "./observability.repository";
import type {
  LifecycleExecutionGuard,
  LifecycleArchiveInput,
  PlatformLifecycleExecutionStore,
} from "./platform-lifecycle-execution.store";
export class PlatformLifecycleExecutionRepository implements PlatformLifecycleExecutionStore {
  private static instance: PlatformLifecycleExecutionRepository;
  static getInstance() {
    return (this.instance ??= new PlatformLifecycleExecutionRepository());
  }
  policy(dataset: Parameters<PlatformLifecycleExecutionStore["policy"]>[0]) {
    if (!isLifecycleDataset(dataset)) throw iamAccountDenied();
    return prisma.dataLifecyclePolicy.findUnique({ where: { dataset } });
  }
  policies() {
    return prisma.dataLifecyclePolicy.findMany({ where: { status: 1 }, orderBy: { dataset: "asc" } });
  }
  private async identity(tx: Prisma.TransactionClient, guard: LifecycleExecutionGuard) {
    if (
      !isLifecycleDataset(guard.dataset) ||
      guard.policy.dataset !== guard.dataset ||
      guard.policy.status !== 1 ||
      !["quyan:system:data_lifecycle:RunPolicy", "quyan:system:data_lifecycle:RunBatch"].includes(guard.action) ||
      guard.users.targetUserId !== guard.users.principal.subjectUserId
    )
      throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const group = await platformManagementGroupSnapshot(
      guard.users.principal,
      Permission.SYSTEM_DATA_LIFECYCLE_MANAGE,
      tx,
    );
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM data_lifecycle_policies WHERE id = ${guard.policy.id} FOR UPDATE`);
    const policy = await tx.dataLifecyclePolicy.findUnique({ where: { id: guard.policy.id } });
    if (
      !policy ||
      policy.status !== 1 ||
      policy.dataset !== guard.dataset ||
      policy.updateTime.getTime() !== guard.policy.updateTime.getTime()
    )
      throw iamAccountDenied();
  }
  private async transaction<T>(guard: LifecycleExecutionGuard, task: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          const result = await task(tx);
          // Do not compare the old policy version after completion's lastRunAt write.
          await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Lifecycle execution state changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
  private whereRun(guard: LifecycleExecutionGuard, runId: string) {
    return {
      id: runId,
      policyId: guard.policy.id,
      dataset: guard.dataset,
      runType: "manual",
      startedByUserId: guard.users.principal.subjectUserId,
      status: 1,
      runStatus: "running",
    };
  }
  private async run(tx: Prisma.TransactionClient, guard: LifecycleExecutionGuard, runId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM data_lifecycle_runs WHERE id = ${runId} FOR UPDATE`);
    const row = await tx.dataLifecycleRun.findFirst({ where: this.whereRun(guard, runId) });
    if (!row) throw iamAccountDenied();
    return row;
  }
  start(guard: LifecycleExecutionGuard, cutoffAt: Date, candidateCount: number) {
    if (!Number.isInteger(candidateCount) || candidateCount < 0 || !Number.isFinite(cutoffAt.getTime()))
      throw iamAccountDenied();
    return this.transaction(guard, (tx) =>
      tx.dataLifecycleRun.create({
        data: {
          policyId: guard.policy.id,
          dataset: guard.dataset,
          runType: "manual",
          cutoffAt,
          candidateCount,
          startedByUserId: guard.users.principal.subjectUserId,
        },
      }),
    );
  }
  async commitArchive(
    guard: LifecycleExecutionGuard,
    artifact: LifecycleArchiveInput,
    records: readonly Record<string, unknown>[],
  ) {
    if (
      artifact.dataset !== guard.dataset ||
      !artifact.objectKey ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      artifact.byteSize <= 0n ||
      artifact.recordCount < 1 ||
      !Number.isInteger(artifact.recordCount) ||
      (guard.dataset === "server_logs"
        ? records.length !== 0 || artifact.recordCount !== 1
        : records.length !== artifact.recordCount)
    )
      throw iamAccountDenied();
    return this.transaction(guard, async (tx) => {
      const run = await this.run(tx, guard, artifact.lifecycleRunId);
      let deletedCount = 0;
      if (guard.dataset !== "server_logs") {
        const ids = records.map((row) => row.id);
        if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length)
          throw iamAccountDenied();
        const delegate = ObservabilityRepository.getInstance().getDatasetDelegate(guard.dataset, tx);
        const where = { id: { in: ids }, createTime: { lt: run.cutoffAt } };
        const current: Record<string, unknown>[] = await delegate.findMany({ where });
        const expected = new Map(records.map((row) => [row.id, row]));
        if (current.length !== records.length || current.some((row) => !isDeepStrictEqual(row, expected.get(row.id))))
          throw iamAccountDenied();
        // Reading and deleting the exact exported rows share this serializable transaction.
        deletedCount = (await delegate.deleteMany({ where })).count;
        if (deletedCount !== records.length) throw iamAccountDenied();
      }
      const saved = await tx.archiveArtifact.create({ data: artifact });
      await tx.dataLifecycleRun.update({
        where: { id: run.id },
        data: { archivedCount: { increment: artifact.recordCount }, deletedCount: { increment: deletedCount } },
      });
      return { artifact: saved, deletedCount };
    });
  }
  async complete(guard: LifecycleExecutionGuard, runId: string) {
    const policy = await this.transaction(guard, async (tx) => {
      await this.run(tx, guard, runId);
      await tx.dataLifecycleRun.update({
        where: { id: runId },
        data: { runStatus: "completed", completedAt: new Date() },
      });
      return tx.dataLifecyclePolicy.update({ where: { id: guard.policy.id }, data: { lastRunAt: new Date() } });
    });
    guard.policy = policy;
    return policy;
  }
  async fail(guard: LifecycleExecutionGuard, runId: string) {
    // Terminal bookkeeping after revocation is limited to this request's own run.
    await prisma.dataLifecycleRun.updateMany({
      where: this.whereRun(guard, runId),
      data: { runStatus: "failed", errorMessage: "Lifecycle archive interrupted", completedAt: new Date() },
    });
  }
  async recordExternalDeletion(guard: LifecycleExecutionGuard, runId: string) {
    if (guard.dataset !== "server_logs") throw iamAccountDenied();
    // Record a file unlink already performed under authorization, even if access was then revoked.
    const result = await prisma.dataLifecycleRun.updateMany({
      where: this.whereRun(guard, runId),
      data: { deletedCount: { increment: 1 } },
    });
    if (result.count !== 1) throw iamAccountDenied();
  }
}
