import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformCollectionCursor } from "../system/platform-collection.store";
import type {
  RelayConfigurationReadTarget,
  RelayConfigurationReadWhere,
  PlatformRelayConfigurationReadStore,
} from "./platform-relay-configuration-read.store";
type Metadata = Pick<RelayConfigurationReadTarget, "recordId" | "status" | "createTime" | "updateTime" | "revision">;
const size = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
// Hash the exact visible projection inputs in SQL; unauthorized payloads never enter the service.
const configRevision = Prisma.sql`SHA2(CAST(JSON_ARRAY(id, status, globalMultiplier, maxConcurrency, queueTimeout, upstreamStreamTimeout, preflightBufferLimitBytes, enableQueue, apiCatalogPoolVisibility, channelTopologyMode, uptimeStatusUrl, monitorNameMapping, showOnlyConfigured, uptimeTransformRules, uptimeStaticData) AS CHAR),256)`;
const priceRevision = Prisma.sql`SHA2(CAST(JSON_ARRAY(id, status, model, pricingType, inputPrice, outputPrice, fixedPrice, provider, cacheCreationMultiplier, cacheReadMultiplier, supportedFormats) AS CHAR),256)`;
export class PlatformRelayConfigurationReadRepository implements PlatformRelayConfigurationReadStore {
  private static instance: PlatformRelayConfigurationReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayConfigurationReadRepository());
  }
  async where(filters: RelayConfigurationReadWhere) {
    if (!(filters.cutoff instanceof Date) || !Number.isFinite(filters.cutoff.getTime())) throw iamAccountDenied();
    return { cutoff: new Date(filters.cutoff) };
  }
  private validCursor(cursor: PlatformCollectionCursor) {
    if (
      !isPlatformLogResourceId(cursor.id) ||
      !/^(config_default|pricing_[A-Za-z0-9_-]+)$/.test(cursor.id) ||
      !(cursor.createTime instanceof Date) ||
      !Number.isFinite(cursor.createTime.getTime())
    )
      throw iamAccountDenied();
  }
  private valid(target: RelayConfigurationReadTarget, source: "config" | "pricing") {
    if (
      target.source !== source ||
      target.status !== 1 ||
      !(target.createTime instanceof Date) ||
      !Number.isFinite(target.createTime.getTime()) ||
      !(target.updateTime instanceof Date) ||
      !Number.isFinite(target.updateTime.getTime()) ||
      !/^[a-f0-9]{64}$/.test(target.revision) ||
      (source === "pricing"
        ? !isPlatformLogResourceId(target.recordId) || target.id !== "pricing_" + target.recordId
        : target.id !== "config_default" || (target.recordId !== null && !isPlatformLogResourceId(target.recordId)))
    )
      throw iamAccountDenied();
  }
  private async configurationMetadata(tx: Prisma.TransactionClient = prisma, lock = false): Promise<Metadata | null> {
    const rows = await tx.$queryRaw<Metadata[]>(
      Prisma.sql`SELECT id AS recordId, status, createTime, updateTime, ${configRevision} AS revision FROM relay_configs WHERE status=1 ORDER BY updateTime DESC, id DESC LIMIT 1 ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
    return rows[0] ?? null;
  }
  private pricingPosition(cursor: PlatformCollectionCursor, inclusive: boolean) {
    this.validCursor(cursor);
    const prefix = "pricing_";
    if (!cursor.id.startsWith(prefix)) return Prisma.sql`createTime < ${cursor.createTime}`;
    const id = cursor.id.slice(prefix.length);
    return inclusive
      ? Prisma.sql`(createTime < ${cursor.createTime} OR (createTime = ${cursor.createTime} AND id <= ${id}))`
      : Prisma.sql`(createTime < ${cursor.createTime} OR (createTime = ${cursor.createTime} AND id < ${id}))`;
  }
  async scan(
    where: RelayConfigurationReadWhere,
    after?: PlatformCollectionCursor,
    boundary?: PlatformCollectionCursor,
  ) {
    if (after) this.validCursor(after);
    if (boundary) this.validCursor(boundary);
    const [config, prices] = await Promise.all([
      this.configurationMetadata(),
      prisma.$queryRaw<Metadata[]>(
        Prisma.sql`SELECT id AS recordId, status, createTime, updateTime, ${priceRevision} AS revision FROM model_pricing WHERE status=1 AND createTime <= ${where.cutoff} ${after ? Prisma.sql`AND ${this.pricingPosition(after, false)}` : Prisma.empty} ${boundary ? Prisma.sql`AND ${this.pricingPosition(boundary, true)}` : Prisma.empty} ORDER BY createTime DESC, id DESC LIMIT ${size}`,
      ),
    ]);
    const configTarget: RelayConfigurationReadTarget = {
      id: "config_default",
      source: "config",
      ...(config ?? {
        recordId: null,
        status: 1,
        createTime: new Date(0),
        updateTime: new Date(0),
        revision: "0".repeat(64),
      }),
    };
    const within = (cursor: PlatformCollectionCursor, inclusive: boolean) =>
      configTarget.createTime < cursor.createTime ||
      (configTarget.createTime.getTime() === cursor.createTime.getTime() &&
        (inclusive ? configTarget.id <= cursor.id : configTarget.id < cursor.id));
    const targets: RelayConfigurationReadTarget[] = prices.map((row) => ({
      ...row,
      id: "pricing_" + row.recordId,
      source: "pricing",
    }));
    if ((!after || within(after, false)) && (!boundary || within(boundary, true))) targets.push(configTarget);
    for (const target of targets) this.valid(target, target.source);
    return targets
      .sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, size);
  }
  async hydrateConfiguration(target: RelayConfigurationReadTarget) {
    this.valid(target, "config");
    return prisma.$transaction(
      async (tx) => {
        // Keep the revision check and Prisma payload read under the same row/range lock.
        const current = await this.configurationMetadata(tx, true);
        if (!target.recordId) {
          if (current) throw iamAccountDenied();
          return null;
        }
        if (
          !current ||
          current.recordId !== target.recordId ||
          current.revision !== target.revision ||
          current.createTime.getTime() !== target.createTime.getTime() ||
          current.updateTime.getTime() !== target.updateTime.getTime()
        )
          throw iamAccountDenied();
        const row = await tx.relayConfig.findFirst({
          where: { id: target.recordId, status: 1, createTime: target.createTime, updateTime: target.updateTime },
        });
        if (!row) throw iamAccountDenied();
        return row;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async hydratePricing(targets: readonly RelayConfigurationReadTarget[]) {
    if (!targets.length) return [];
    if (targets.length > size || new Set(targets.map((row) => row.recordId)).size !== targets.length)
      throw iamAccountDenied();
    for (const target of targets) this.valid(target, "pricing");
    return prisma.$transaction(
      async (tx) => {
        const metadata = await tx.$queryRaw<Metadata[]>(Prisma.sql`
        SELECT id AS recordId, status, createTime, updateTime, ${priceRevision} AS revision
        FROM model_pricing WHERE id IN (${Prisma.join(targets.map((row) => row.recordId!))}) ORDER BY id FOR UPDATE
      `);
        if (
          metadata.length !== targets.length ||
          metadata.some(
            (row) =>
              row.status !== 1 ||
              !targets.some(
                (target) =>
                  target.recordId === row.recordId &&
                  target.revision === row.revision &&
                  target.createTime.getTime() === row.createTime.getTime() &&
                  target.updateTime.getTime() === row.updateTime.getTime(),
              ),
          )
        )
          throw iamAccountDenied();
        const rows = await tx.modelPricing.findMany({
          where: {
            status: 1,
            OR: targets.map((row) => ({ id: row.recordId!, createTime: row.createTime, updateTime: row.updateTime })),
          },
          orderBy: { model: "asc" },
        });
        if (rows.length !== targets.length) throw iamAccountDenied();
        return rows;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
