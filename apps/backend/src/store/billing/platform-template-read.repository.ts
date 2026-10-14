import { Prisma } from "@prisma/client";
import type { IamPrincipal, IamPlatformTemplateKind } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformTemplateDefinition } from "@/iam/resources/platform-template-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformCollectionCursor } from "../system/platform-collection.store";
import type {
  PlatformTemplateFilters,
  PlatformTemplateReadStore,
  PlatformTemplateTarget,
  PlatformTemplateRecordMap,
} from "./platform-template-read.store";

const modelNames = {
  "monthly-pass": "MonthlyPassTemplate",
  "remote-terminal": "RemoteTerminalProductTemplate",
  carpool: "CarpoolPackageTemplate",
} as const;
/** SQL identifiers and revision fields are derived exclusively from Prisma's registered schema. */
const identifier = (name: string) => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw iamAccountDenied();
  return Prisma.raw("`" + name + "`");
};
export function validPlatformTemplateTarget(row: PlatformTemplateTarget) {
  return (
    !!row &&
    isPlatformLogResourceId(row.id) &&
    [-1, 0, 1].includes(row.status) &&
    /^[a-f0-9]{64}$/.test(row.revision) &&
    Number.isSafeInteger(row.displayOrder) &&
    row.displayOrder > 0 &&
    [row.createTime, row.updateTime].every((value) => value instanceof Date && Number.isFinite(value.getTime()))
  );
}
export class PlatformTemplateReadRepository<K extends IamPlatformTemplateKind> implements PlatformTemplateReadStore<K> {
  private static readonly instances = new Map<
    IamPlatformTemplateKind,
    PlatformTemplateReadRepository<IamPlatformTemplateKind>
  >();
  static getInstance<K extends IamPlatformTemplateKind>(kind: K): PlatformTemplateReadRepository<K> {
    let instance = this.instances.get(kind);
    if (!instance) {
      instance = new PlatformTemplateReadRepository(kind);
      this.instances.set(kind, instance);
    }
    return instance as PlatformTemplateReadRepository<K>;
  }
  constructor(private readonly kind: K) {}
  async where(filters: PlatformTemplateFilters) {
    if (
      (filters.status !== undefined && ![-1, 0, 1].includes(filters.status)) ||
      (filters.keyword !== undefined && (typeof filters.keyword !== "string" || filters.keyword.length > 200)) ||
      (filters.publishStatus !== undefined && !["draft", "published"].includes(filters.publishStatus))
    )
      throw iamAccountDenied();
    return { ...filters };
  }
  private model() {
    const model = Prisma.dmmf.datamodel.models.find((entry) => entry.name === modelNames[this.kind]);
    if (!model) throw iamAccountDenied();
    return model;
  }
  private revision() {
    const scalarColumns = (model: (typeof Prisma.dmmf.datamodel.models)[number], alias: string) =>
      model.fields
        .filter((field) => field.kind !== "object")
        .map((field) => Prisma.sql`${identifier(alias)}.${identifier(field.dbName ?? field.name)}`);
    const columns = scalarColumns(this.model(), "t");
    if (this.kind === "monthly-pass") {
      const child = Prisma.dmmf.datamodel.models.find((entry) => entry.name === "MonthlyPassTemplateQuotaWindow");
      if (!child) throw iamAccountDenied();
      // The ordered, complete window aggregate is computed in SQL; quota content never enters a metadata scan.
      columns.push(Prisma.sql`COALESCE((SELECT CAST(JSON_ARRAYAGG(JSON_ARRAY(${Prisma.join(scalarColumns(child, "q"))}))
        OVER (ORDER BY q.id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS CHAR)
        FROM ${identifier(child.dbName ?? child.name)} q WHERE q.monthlyPassTemplateId=t.id LIMIT 1), '[]')`);
    }
    return Prisma.sql`SHA2(CAST(JSON_ARRAY(${Prisma.join(columns)}) AS CHAR),256)`;
  }
  private selection(filters: PlatformTemplateFilters) {
    const model = this.model();
    const table = identifier(model.dbName ?? model.name),
      keyword = filters.keyword;
    const where = Prisma.sql`t.status ${filters.status === undefined ? Prisma.sql`>= 0` : Prisma.sql`= ${filters.status}`}
      ${keyword ? Prisma.sql`AND (LOCATE(${keyword}, t.name) > 0 OR LOCATE(${keyword}, t.description) > 0)` : Prisma.empty}
      ${filters.publishStatus ? Prisma.sql`AND t.publishStatus = ${filters.publishStatus}` : Prisma.empty}`;
    const order =
      this.kind === "remote-terminal"
        ? Prisma.sql`t.updateTime DESC,t.id DESC`
        : this.kind === "monthly-pass"
          ? Prisma.sql`t.name ASC,t.updateTime DESC,t.id DESC`
          : Prisma.sql`t.createTime DESC,t.id DESC`;
    return Prisma.sql`SELECT t.id,t.status,t.createTime,t.updateTime,${this.revision()} AS revision,
      ROW_NUMBER() OVER(ORDER BY ${order}) AS displayOrder FROM ${table} t WHERE ${where}`;
  }
  async scan(filters: PlatformTemplateFilters, after?: PlatformCollectionCursor, boundary?: PlatformCollectionCursor) {
    for (const cursor of [after, boundary])
      if (
        cursor &&
        (!isPlatformLogResourceId(cursor.id) ||
          !(cursor.createTime instanceof Date) ||
          !Number.isFinite(cursor.createTime.getTime()))
      )
        throw iamAccountDenied();
    const rows = await prisma.$queryRaw<
      (Omit<PlatformTemplateTarget, "displayOrder"> & { displayOrder: bigint })[]
    >(Prisma.sql`
      SELECT * FROM (${this.selection(filters)}) metadata WHERE 1=1
      ${after ? Prisma.sql`AND (createTime < ${after.createTime} OR (createTime = ${after.createTime} AND id < ${after.id}))` : Prisma.empty}
      ${boundary ? Prisma.sql`AND (createTime < ${boundary.createTime} OR (createTime = ${boundary.createTime} AND id <= ${boundary.id}))` : Prisma.empty}
      ORDER BY createTime DESC,id DESC LIMIT ${IAM_AUTHORIZATION_LIMITS.resourcesPerRequest}`);
    const result = rows.map((row) => ({ ...row, displayOrder: Number(row.displayOrder) }));
    if (result.some((row) => !validPlatformTemplateTarget(row))) throw iamAccountDenied();
    return result;
  }
  async hydrate(
    principal: IamPrincipal,
    targets: readonly PlatformTemplateTarget[],
  ): Promise<PlatformTemplateRecordMap[K][]> {
    if (!targets.length) return [];
    if (
      targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(targets.map((row) => row.id)).size !== targets.length ||
      targets.some((row) => !validPlatformTemplateTarget(row))
    )
      throw iamAccountDenied();
    const permission = platformTemplateDefinition(this.kind).legacyPermission;
    return prisma.$transaction(
      async (tx) => {
        await platformManagementGroupSnapshot(principal, permission, tx);
        const rows =
          this.kind === "remote-terminal"
            ? await tx.remoteTerminalProductTemplate.findMany({
                where: { id: { in: targets.map((row) => row.id) }, status: { in: [-1, 0, 1] } },
              })
            : this.kind === "carpool"
              ? await tx.carpoolPackageTemplate.findMany({
                  where: { id: { in: targets.map((row) => row.id) }, status: { in: [-1, 0, 1] } },
                })
              : await tx.monthlyPassTemplate.findMany({
                  where: { id: { in: targets.map((row) => row.id) }, status: { in: [-1, 0, 1] } },
                  include: { quotaWindows: { orderBy: [{ quotaWindowHours: "asc" }, { createTime: "asc" }] } },
                });
        const model = this.model();
        const revisions = await tx.$queryRaw<{ id: string; revision: string }[]>(
          Prisma.sql`SELECT t.id,${this.revision()} AS revision FROM ${identifier(model.dbName ?? model.name)} t WHERE t.id IN (${Prisma.join(targets.map((row) => row.id))}) FOR UPDATE`,
        );
        if (
          rows.length !== targets.length ||
          revisions.length !== targets.length ||
          targets.some((target) => !revisions.some((row) => row.id === target.id && row.revision === target.revision))
        )
          throw iamAccountDenied();
        await platformManagementGroupSnapshot(principal, permission, tx);
        const byId = new Map(rows.map((row) => [row.id, row]));
        if (
          rows.some(
            (row) =>
              !targets.some(
                (target) =>
                  target.id === row.id &&
                  target.status === row.status &&
                  target.updateTime.getTime() === row.updateTime.getTime(),
              ),
          )
        )
          throw iamAccountDenied();
        return targets.map((target) => byId.get(target.id)!) as PlatformTemplateRecordMap[K][];
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
