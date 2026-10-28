import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { isLifecycleDataset } from "@/iam/resources/platform-lifecycle-resources";
import {
  updateLifecyclePolicyBodySchema,
  updateLifecycleScheduleBodySchema,
} from "@/api/schema/system/data-lifecycle.schema";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import { ConflictError } from "@/util/errors";
import { LIFECYCLE_POLICY_TARGET_SELECT, LIFECYCLE_SCHEDULE_TARGET_SELECT } from "./platform-lifecycle-control.store";
import type {
  LifecycleControlGuard,
  LifecycleScheduleTarget,
  PlatformLifecycleControlStore,
} from "./platform-lifecycle-control.store";
const scheduleKeys = Object.values(CONFIG_KEYS.DATA_LIFECYCLE).sort();
export class PlatformLifecycleControlRepository implements PlatformLifecycleControlStore {
  private static instance: PlatformLifecycleControlRepository;
  static getInstance() {
    return (this.instance ??= new PlatformLifecycleControlRepository());
  }
  private actor(principal: IamPrincipal, tx?: Prisma.TransactionClient) {
    return platformManagementGroupSnapshot(principal, Permission.SYSTEM_DATA_LIFECYCLE_MANAGE, tx);
  }
  async policyTarget(principal: IamPrincipal, dataset: string) {
    await this.actor(principal);
    if (!isLifecycleDataset(dataset)) throw iamAccountDenied();
    return prisma.dataLifecyclePolicy.findUnique({ where: { dataset }, select: LIFECYCLE_POLICY_TARGET_SELECT });
  }
  async scheduleTargets(principal: IamPrincipal) {
    await this.actor(principal);
    return prisma.serverConfig.findMany({
      where: { key: { in: scheduleKeys } },
      select: LIFECYCLE_SCHEDULE_TARGET_SELECT,
    });
  }
  private async identity(tx: Prisma.TransactionClient, guard: LifecycleControlGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id = ${guard.group.id} FOR UPDATE`);
    const group = await this.actor(guard.users.principal, tx);
    if (group.id !== guard.group.id || group.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  private async transaction<T>(read: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(read, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Lifecycle configuration authorization changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
  async updatePolicy(guard: LifecycleControlGuard, input: { enabled: boolean; hotRetentionDays: number }) {
    const parsed = updateLifecyclePolicyBodySchema.strict().safeParse(input);
    if (
      guard.action !== "quyan:system:data_lifecycle:UpdatePolicy" ||
      !guard.dataset ||
      !isLifecycleDataset(guard.dataset) ||
      !guard.policy ||
      guard.policy.dataset !== guard.dataset ||
      guard.policy.status !== 1 ||
      guard.configs.length ||
      !parsed.success
    )
      throw iamAccountDenied();
    const target = guard.policy;
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM data_lifecycle_policies WHERE id = ${target.id} FOR UPDATE`);
      const row = await tx.dataLifecyclePolicy.findUnique({
        where: { id: target.id },
        select: LIFECYCLE_POLICY_TARGET_SELECT,
      });
      if (
        !row ||
        row.dataset !== target.dataset ||
        row.status !== 1 ||
        row.updateTime.getTime() !== target.updateTime.getTime()
      )
        throw iamAccountDenied();
      const result = await tx.dataLifecyclePolicy.update({ where: { id: target.id }, data: parsed.data });
      await this.identity(tx, guard);
      return result;
    });
  }
  private sameConfigs(expected: readonly LifecycleScheduleTarget[], current: readonly LifecycleScheduleTarget[]) {
    if (
      expected.length !== current.length ||
      expected.some(
        (e) =>
          !current.some(
            (c) =>
              c.id === e.id && c.key === e.key && c.status === 1 && c.updateTime.getTime() === e.updateTime.getTime(),
          ),
      )
    )
      throw iamAccountDenied();
  }
  async updateSchedule(guard: LifecycleControlGuard, input: { enabled: boolean; time: string }) {
    const parsed = updateLifecycleScheduleBodySchema.strict().safeParse(input);
    if (
      guard.action !== "quyan:system:data_lifecycle:UpdateSchedule" ||
      guard.dataset !== undefined ||
      guard.policy !== undefined ||
      !parsed.success ||
      guard.configs.length > scheduleKeys.length ||
      new Set(guard.configs.map((c) => c.key)).size !== guard.configs.length ||
      guard.configs.some((c) => c.status !== 1 || !scheduleKeys.some((key) => key === c.key))
    )
      throw iamAccountDenied();
    const updates = {
      [CONFIG_KEYS.DATA_LIFECYCLE.SCHEDULE_ENABLED]: String(parsed.data.enabled),
      [CONFIG_KEYS.DATA_LIFECYCLE.SCHEDULE_TIME]: parsed.data.time,
    };
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM server_configs WHERE \`key\` IN (${Prisma.join(scheduleKeys)}) ORDER BY id FOR UPDATE`,
      );
      this.sameConfigs(
        guard.configs,
        await tx.serverConfig.findMany({
          where: { key: { in: scheduleKeys } },
          select: LIFECYCLE_SCHEDULE_TARGET_SELECT,
        }),
      );
      for (const key of scheduleKeys)
        await tx.serverConfig.upsert({
          where: { key },
          create: { key, value: updates[key] },
          update: { value: updates[key] },
        });
      await this.identity(tx, guard);
    });
  }
}
