import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { platformScalarColumns } from "../system/platform-scalar-revision";
import type { PlatformCollectionCursor } from "../system/platform-collection.store";
import type {
  MonthlyPassFilterKind,
  MonthlyPassFilterTarget,
  MonthlyPassFilterScope,
  MonthlyPassFilterRecord,
  MonthlyPassFilterOptionsStore,
} from "./monthly-pass-filter-options.store";
const sources = {
  template: {
    model: "MonthlyPassTemplate",
    fields: ["id", "status", "createTime", "updateTime", "name", "publishStatus"],
  },
  model: { model: "ModelPricing", fields: ["id", "status", "createTime", "updateTime", "model"] },
  channel: {
    model: "RelayChannel",
    fields: [
      "id",
      "status",
      "createTime",
      "updateTime",
      "name",
      "providerServiceEnabled",
      "visibilityMode",
      "visibilityConfig",
    ],
  },
  group: {
    model: "Group",
    fields: ["id", "status", "createTime", "updateTime", "username", "name", "level", "accountOwnerId"],
  },
} as const;
export function validMonthlyPassFilterTarget(row: MonthlyPassFilterTarget) {
  return (
    !!row &&
    isPlatformLogResourceId(row.id) &&
    [0, 1].includes(row.status) &&
    /^[a-f0-9]{64}$/.test(row.revision) &&
    [row.createTime, row.updateTime].every((value) => value instanceof Date && Number.isFinite(value.getTime()))
  );
}
/** Only option display fields and visibility metadata are selected; no upstream credentials or group permissions. */
export class MonthlyPassFilterOptionsRepository implements MonthlyPassFilterOptionsStore {
  private static instance: MonthlyPassFilterOptionsRepository;
  static getInstance() {
    return (this.instance ??= new MonthlyPassFilterOptionsRepository());
  }
  async scope(groupId: string) {
    if (!isPlatformLogResourceId(groupId)) throw iamAccountDenied();
    const row = await prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, level: true, status: true, accountOwnerId: true },
    });
    if (!row || row.status !== 1 || row.accountOwnerId !== null || !Number.isSafeInteger(row.level))
      throw iamAccountDenied();
    return { groupId: row.id, minGroupLevel: row.level };
  }
  private async metadata(
    kind: MonthlyPassFilterKind,
    scope: MonthlyPassFilterScope,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
    ids?: readonly string[],
    tx: Prisma.TransactionClient = prisma,
  ) {
    if (
      !Object.hasOwn(sources, kind) ||
      !isPlatformLogResourceId(scope.groupId) ||
      !Number.isSafeInteger(scope.minGroupLevel)
    )
      throw iamAccountDenied();
    for (const cursor of [after, boundary])
      if (
        cursor &&
        (!isPlatformLogResourceId(cursor.id) ||
          !(cursor.createTime instanceof Date) ||
          !Number.isFinite(cursor.createTime.getTime()))
      )
        throw iamAccountDenied();
    if (
      ids &&
      (!ids.length ||
        ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
        ids.some((id) => !isPlatformLogResourceId(id)))
    )
      throw iamAccountDenied();
    const source = sources[kind],
      model = Prisma.dmmf.datamodel.models.find((entry) => entry.name === source.model);
    if (!model || !/^[A-Za-z][A-Za-z0-9_]*$/.test(model.dbName ?? model.name)) throw iamAccountDenied();
    const table = Prisma.raw("`" + (model.dbName ?? model.name) + "`");
    const rows = await tx.$queryRaw<MonthlyPassFilterTarget[]>(Prisma.sql`
      SELECT t.id,t.status,t.createTime,t.updateTime,SHA2(CAST(JSON_ARRAY(${Prisma.join(platformScalarColumns(source.model, "t", source.fields))}) AS CHAR),256) AS revision
      FROM ${table} t WHERE t.status ${kind === "template" ? Prisma.sql`>= 0` : Prisma.sql`= 1`}
      ${kind === "group" ? Prisma.sql`AND t.accountOwnerId IS NULL AND t.level >= ${scope.minGroupLevel}` : Prisma.empty}
      ${kind === "channel" ? Prisma.sql`AND t.providerServiceEnabled=1 AND t.visibilityMode<>'hidden'` : Prisma.empty}
      ${ids ? Prisma.sql`AND t.id IN (${Prisma.join([...ids])})` : Prisma.empty}
      ${after ? Prisma.sql`AND (t.createTime<${after.createTime} OR (t.createTime=${after.createTime} AND t.id<${after.id}))` : Prisma.empty}
      ${boundary ? Prisma.sql`AND (t.createTime<${boundary.createTime} OR (t.createTime=${boundary.createTime} AND t.id<=${boundary.id}))` : Prisma.empty}
      ORDER BY t.createTime DESC,t.id DESC LIMIT ${IAM_AUTHORIZATION_LIMITS.resourcesPerRequest}`);
    if (rows.some((row) => !validMonthlyPassFilterTarget(row))) throw iamAccountDenied();
    return rows;
  }
  scan(
    kind: MonthlyPassFilterKind,
    scope: MonthlyPassFilterScope,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
  ) {
    return this.metadata(kind, scope, after, boundary);
  }
  async verify(
    kind: MonthlyPassFilterKind,
    scope: MonthlyPassFilterScope,
    targets: readonly MonthlyPassFilterTarget[],
    tx: Prisma.TransactionClient = prisma,
  ) {
    if (!targets.length) return;
    if (
      targets.some((row) => !validMonthlyPassFilterTarget(row)) ||
      new Set(targets.map((row) => row.id)).size !== targets.length
    )
      throw iamAccountDenied();
    const current = await this.metadata(
      kind,
      scope,
      undefined,
      undefined,
      targets.map((row) => row.id),
      tx,
    );
    if (
      current.length !== targets.length ||
      targets.some((row) => !current.some((next) => next.id === row.id && next.revision === row.revision))
    )
      throw iamAccountDenied();
  }
  async hydrate(
    kind: MonthlyPassFilterKind,
    scope: MonthlyPassFilterScope,
    targets: readonly MonthlyPassFilterTarget[],
  ): Promise<MonthlyPassFilterRecord[]> {
    if (!targets.length) return [];
    return prisma.$transaction(
      async (tx) => {
        await this.verify(kind, scope, targets, tx);
        const ids = targets.map((row) => row.id);
        switch (kind) {
          case "template":
            return (
              await tx.monthlyPassTemplate.findMany({
                where: { id: { in: ids }, status: { gte: 0 } },
                select: { id: true, name: true, status: true, publishStatus: true },
              })
            ).map((row) => ({ kind, ...row }));
          case "model":
            return (
              await tx.modelPricing.findMany({
                where: { id: { in: ids }, status: 1 },
                select: { id: true, model: true, status: true },
              })
            ).map((row) => ({ kind, ...row }));
          case "channel":
            return (
              await tx.relayChannel.findMany({
                where: { id: { in: ids }, status: 1, providerServiceEnabled: true, visibilityMode: { not: "hidden" } },
                select: { id: true, name: true, status: true, visibilityMode: true, visibilityConfig: true },
              })
            ).map((row) => ({ kind, ...row }));
          case "group":
            return (
              await tx.group.findMany({
                where: { id: { in: ids }, status: 1, accountOwnerId: null, level: { gte: scope.minGroupLevel } },
                select: { id: true, name: true, username: true, status: true },
              })
            ).map((row) => ({ kind, ...row }));
          default:
            throw iamAccountDenied();
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
