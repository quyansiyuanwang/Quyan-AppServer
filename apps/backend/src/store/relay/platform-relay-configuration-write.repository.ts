import { DEFAULT_RELAY_CONFIG } from "@/constant/relay-config";
import { isRelayConfigurationModelName } from "@/util/relay-configuration-update";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { platformRelayConfigurationArn } from "@/iam/resources/platform-relay-configuration-resources";
import {
  platformModelPricingArn,
  platformModelPricingCollectionArn,
  isModelPricingRecordId,
} from "@/iam/resources/platform-model-pricing-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { MODEL_PRICING_IMPORT_TRANSACTION_TIMEOUT_MS } from "@/constant/pricing";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { assertRelayConfigurationTopology } from "@/util/relay-configuration-topology";
import { ConflictError } from "@/util/errors";
import { iamAccountDenied, assertIamAccountPrincipal } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { configRevision, priceRevision } from "./relay-configuration-revisions";
import { writeRelayConfigurationModelRates } from "./relay-configuration-model-rates";
import { projectRelayConfiguration, projectRelayModelRates } from "@/services/relay/relay-configuration-projection";
import type { RelayModelRateInput } from "./relay-config.store";
import type {
  RelayConfigurationWriteMetadata,
  RelayConfigurationWriteTarget,
  RelayConfigurationWriteGuard,
  PlatformRelayConfigurationWriteStore,
} from "./platform-relay-configuration-write.store";
const size = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
export class PlatformRelayConfigurationWriteRepository implements PlatformRelayConfigurationWriteStore {
  private static instance: PlatformRelayConfigurationWriteRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayConfigurationWriteRepository());
  }
  async authorizationRevision(principal: IamPrincipal) {
    await assertIamAccountPrincipal(principal);
    return readIamAuthorizationRevision(prisma, principal.accountOwnerId);
  }
  private async configuration(tx: Prisma.TransactionClient = prisma) {
    const rows = await tx.$queryRaw<NonNullable<RelayConfigurationWriteTarget["config"]>[]>(Prisma.sql`
      SELECT id,status,createTime,updateTime,channelTopologyMode,${configRevision} AS revision
      FROM relay_configs WHERE status=1 ORDER BY updateTime DESC,id DESC LIMIT 1
    `);
    return rows[0] ?? null;
  }
  private pricingWhere(models: readonly string[]) {
    return models.length ? Prisma.sql`(status=1 OR model IN (${Prisma.join(models)}))` : Prisma.sql`status=1`;
  }
  private async prices(models: readonly string[], tx: Prisma.TransactionClient = prisma) {
    return tx.$queryRaw<RelayConfigurationWriteTarget["prices"]>(Prisma.sql`
      SELECT id,model,status,createTime,updateTime,${priceRevision} AS revision FROM model_pricing
      WHERE ${this.pricingWhere(models)} ORDER BY id
    `);
  }
  async prepare(models?: readonly string[]) {
    if (
      models &&
      (new Set(models).size !== models.length || models.some((model) => !isRelayConfigurationModelName(model)))
    )
      throw iamAccountDenied();
    const config = await this.configuration();
    const prices = models === undefined ? [] : await this.prices(models);
    return { config, prices };
  }
  private valid(row: RelayConfigurationWriteMetadata) {
    return (
      isModelPricingRecordId(row.id) &&
      row.createTime instanceof Date &&
      Number.isFinite(row.createTime.getTime()) &&
      row.updateTime instanceof Date &&
      Number.isFinite(row.updateTime.getTime()) &&
      /^[a-f0-9]{64}$/.test(row.revision)
    );
  }
  private same(a: RelayConfigurationWriteMetadata, b: RelayConfigurationWriteMetadata) {
    return (
      this.valid(a) &&
      this.valid(b) &&
      a.id === b.id &&
      a.status === b.status &&
      a.revision === b.revision &&
      a.createTime.getTime() === b.createTime.getTime() &&
      a.updateTime.getTime() === b.updateTime.getTime()
    );
  }
  private async identity(tx: Prisma.TransactionClient, guard: RelayConfigurationWriteGuard) {
    if (!guard.group || !/^[a-f0-9]{64}$/.test(guard.authorizationRevision)) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.principal.subjectUserId);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`);
    const group = await platformManagementGroupSnapshot(guard.users.principal, Permission.MODEL_PRICING_UPDATE, tx);
    if (
      group.id !== guard.group.id ||
      group.updateTime.getTime() !== guard.group.updateTime.getTime() ||
      (await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== guard.authorizationRevision
    )
      throw iamAccountDenied();
  }
  async write(
    target: RelayConfigurationWriteTarget,
    data: Prisma.RelayConfigUncheckedCreateInput,
    rates: readonly RelayModelRateInput[] | undefined,
    guard: RelayConfigurationWriteGuard,
  ) {
    if (
      (target.config !== null && (!this.valid(target.config) || target.config.status !== 1)) ||
      target.prices.some((row) => !this.valid(row)) ||
      new Set(target.prices.map((row) => row.id)).size !== target.prices.length ||
      (rates === undefined && target.prices.length)
    )
      throw iamAccountDenied();
    const models = rates?.map((rate) => rate.model);
    if (models && new Set(models).size !== models.length) throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.identity(tx, guard);
          // Protect replacement of the selected singleton, including concurrent active-row insertions.
          await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_configs WHERE status=1 ORDER BY id FOR UPDATE`);
          const current = await this.configuration(tx);
          if (
            target.config === null
              ? current !== null
              : !current ||
                !this.same(current, target.config) ||
                current.channelTopologyMode !== target.config.channelTopologyMode
          )
            throw iamAccountDenied();
          const affected = [platformRelayConfigurationArn()];
          if (models) {
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM model_pricing WHERE ${this.pricingWhere(models)} ORDER BY id FOR UPDATE`,
            );
            const prices = await this.prices(models, tx);
            if (
              prices.length !== target.prices.length ||
              prices.some((row) => !target.prices.some((old) => this.same(old, row) && old.model === row.model))
            )
              throw iamAccountDenied();
            affected.push(...prices.map((row) => platformModelPricingArn(row.id)));
            if (models.some((model) => !prices.some((row) => row.model === model)))
              affected.push(platformModelPricingCollectionArn());
          }
          await guard.requireResources(affected);
          // Serializable reads keep every contributing topology row and relation stable through commit.
          if (
            data.channelTopologyMode === "strict-two-tier" &&
            (current?.channelTopologyMode ?? DEFAULT_RELAY_CONFIG.channelTopologyMode) !== "strict-two-tier"
          ) {
            const channels = await tx.relayChannel.findMany({
              where: { status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              orderBy: { id: "asc" },
              select: {
                id: true,
                name: true,
                channelType: true,
                pooledParentId: true,
                poolMembers: { select: { memberChannelId: true } },
              },
            });
            assertRelayConfigurationTopology(channels);
          }
          const createFields = Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined),
          ) as Prisma.RelayConfigUncheckedCreateInput;
          const saved = current
            ? await tx.relayConfig.update({ where: { id: current.id }, data })
            : await tx.relayConfig.create({ data: { ...DEFAULT_RELAY_CONFIG, ...createFields, status: 1 } });
          const ids = rates ? await writeRelayConfigurationModelRates(tx, rates, target.prices) : [];
          const committedResources = [...new Set([...affected, ...ids.map((id) => platformModelPricingArn(id))])];
          await guard.requireResources(committedResources);
          // The mutation can succeed without a separate read grant. Filter its price response inside this transaction.
          const priceMetadata = await tx.modelPricing.findMany({
            where: { status: 1 },
            orderBy: { id: "asc" },
            select: { id: true },
          });
          const allowed = await guard.readablePricingIds(priceMetadata.map((row) => row.id));
          if ([...allowed].some((id) => !priceMetadata.some((row) => row.id === id))) throw iamAccountDenied();
          const visible = [];
          const visibleIds = [...allowed];
          for (let index = 0; index < visibleIds.length; index += size) {
            visible.push(
              ...(await tx.modelPricing.findMany({
                where: { status: 1, id: { in: visibleIds.slice(index, index + size) } },
              })),
            );
          }
          if (visible.length !== visibleIds.length) throw iamAccountDenied();
          visible.sort((a, b) => a.model.localeCompare(b.model));
          await this.identity(tx, guard);
          const readableAtReturn = await guard.readablePricingIds(visibleIds);
          if ([...readableAtReturn].some((id) => !allowed.has(id))) throw iamAccountDenied();
          await guard.requireResources(committedResources);
          return {
            ...projectRelayConfiguration(
              saved,
              projectRelayModelRates(visible.filter((row) => readableAtReturn.has(row.id))),
            ),
            id: saved.id,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: MODEL_PRICING_IMPORT_TRANSACTION_TIMEOUT_MS,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Relay configuration or authorization changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}
