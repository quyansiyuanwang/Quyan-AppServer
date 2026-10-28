import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { ApiError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import { relayChannelChangeValidationSourceSelect } from "./relay-channel-change-request-create.repository";
import { relayChannelChangeRequestPublicSelect } from "./relay-channel-change-request-read.repository";
import { assertRelayChannelChangeProviderBindings } from "./relay-channel-change-provider-bindings";
import { RelayChannelProviderConfigRepository } from "./relay-channel-provider-config.repository";
import { readRelayChannelCredentialPresence } from "./relay-channel-credential-presence";
import { projectRelayChannelChangeRequest } from "@/services/relay/relay-channel-change-request-projection";
import type { RelayChannelCredentialPresence } from "@/services/relay/relay-channel-configuration-projection";
import type { RelayModelCatalogEntry } from "@/services/relay/relay-pool-resolver.service";
import type {
  ReviewRelayChannelChangeRequest,
  RelayChannelProviderConfigRequest,
} from "@/api/dto/relay/relay-channel.dto";
const reviewPolicy = Object.freeze({ timeoutMs: 30000 });
const linkSelect = {
  id: true,
  relayChannelId: true,
  submittedByUserId: true,
  status: true,
  reviewStatus: true,
  updateTime: true,
} as const;
const publicSelect = { ...relayChannelChangeRequestPublicSelect, reviewedByUserId: true } as const;
const providerSelect = {
  id: true,
  userId: true,
  status: true,
  updateTime: true,
  commissionPercent: true,
  settlementMode: true,
  settlementIntervalDays: true,
  settlementTime: true,
  nextSettlementAt: true,
  lastSettledAt: true,
} as const;
const channelSelect = {
  ...relayChannelChangeValidationSourceSelect,
  providers: { where: { status: 1 }, select: providerSelect, orderBy: { userId: "asc" } },
} as const satisfies Prisma.RelayChannelSelect;
const userSelect = { id: true, status: true, updateTime: true, accountOwnerId: true, username: true } as const;
type Link = Prisma.RelayChannelChangeRequestGetPayload<{ select: typeof linkSelect }>;
type Row = Prisma.RelayChannelChangeRequestGetPayload<{ select: typeof publicSelect }>;
type Source = Prisma.RelayChannelGetPayload<{ select: typeof channelSelect }>;
type Targets = Awaited<ReturnType<RelayChannelProviderConfigRepository["providers"]>>;
type Credentials = {
  encryptedCredentials: string | null;
  credentialIv: string | null;
  credentialAuthTag: string | null;
};
export type ChangeRequestReviewPreparation = (
  row: Row & Credentials,
  source: Source,
  presence: RelayChannelCredentialPresence,
  catalog: readonly RelayModelCatalogEntry[],
) => Promise<Prisma.RelayChannelUncheckedUpdateManyInput>;
export type ChangeRequestProviderPreparation = (
  input: RelayChannelProviderConfigRequest,
  userId: string,
  now: Date,
) => {
  userId: string;
  commissionPercent: number;
  settlementMode: string;
  settlementIntervalDays?: number | null;
  settlementTime?: string | null;
  nextSettlementAt?: Date | null;
};
interface Guard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
const providerValues = (row: ReturnType<ChangeRequestProviderPreparation> | Source["providers"][number]) => ({
  userId: row.userId,
  commissionPercent: Number(new Prisma.Decimal(row.commissionPercent).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)),
  settlementMode: row.settlementMode,
  settlementIntervalDays: row.settlementIntervalDays ?? null,
  settlementTime: row.settlementTime ?? null,
  nextSettlementAt: row.nextSettlementAt ?? null,
});
/** Reject restoration uses only server-recorded, strictly checked lifecycle metadata, not proposed config. */
function previousState(row: Row, channel: Source) {
  const snapshot = row.configSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw iamAccountDenied();
  const submissionStatus = Object.hasOwn(snapshot, "previousSubmissionStatus")
      ? snapshot.previousSubmissionStatus
      : channel.submissionStatus,
    status = Object.hasOwn(snapshot, "previousChannelStatus") ? snapshot.previousChannelStatus : channel.status,
    providerServiceEnabled = Object.hasOwn(snapshot, "previousProviderServiceEnabled")
      ? snapshot.previousProviderServiceEnabled
      : channel.providerServiceEnabled;
  if (
    typeof submissionStatus !== "string" ||
    !["pending", "approved", "rejected"].includes(submissionStatus) ||
    (status !== RELAY_CHANNEL_STATUS.ENABLED && status !== RELAY_CHANNEL_STATUS.DISABLED) ||
    typeof providerServiceEnabled !== "boolean"
  )
    throw iamAccountDenied();
  return { submissionStatus, status, providerServiceEnabled };
}
const comparable = (value: unknown) =>
  value instanceof Prisma.Decimal ? Number(value) : value === Prisma.JsonNull || value === Prisma.DbNull ? null : value;
export class RelayChannelChangeRequestReviewRepository {
  private static instance: RelayChannelChangeRequestReviewRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelChangeRequestReviewRepository());
  }
  async link(id: string, tx: Prisma.TransactionClient = prisma) {
    const row = await tx.relayChannelChangeRequest.findFirst({ where: { id, status: 1 }, select: linkSelect });
    if (!row || row.id !== id || !["pending", "approved", "rejected"].includes(row.reviewStatus))
      throw iamAccountDenied();
    return row;
  }
  async candidate(link: Link, tx: Prisma.TransactionClient = prisma) {
    if (!same(link, await this.link(link.id, tx))) throw iamAccountDenied();
    const row = await tx.relayChannelChangeRequest.findUnique({ where: { id: link.id }, select: publicSelect }),
      channel = await tx.relayChannel.findFirst({
        where: { id: link.relayChannelId, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
        select: channelSelect,
      });
    if (
      !row ||
      !channel ||
      row.status !== 1 ||
      row.relayChannelId !== channel.id ||
      row.submittedByUserId !== channel.submittedByUserId ||
      channel.channelType !== "standalone" ||
      !same(link, {
        id: row.id,
        relayChannelId: row.relayChannelId,
        submittedByUserId: row.submittedByUserId,
        status: row.status,
        reviewStatus: row.reviewStatus,
        updateTime: row.updateTime,
      })
    )
      throw iamAccountDenied();
    return { link, row, channel };
  }
  async providers(row: Row) {
    const config = projectRelayChannelChangeRequest(row).config;
    return config.providers === undefined
      ? undefined
      : RelayChannelProviderConfigRepository.getInstance().providers(config.providers);
  }
  async apply<T>(
    target: Awaited<ReturnType<RelayChannelChangeRequestReviewRepository["candidate"]>>,
    input: ReviewRelayChannelChangeRequest,
    targets: Targets | undefined,
    guard: Guard,
    persist: boolean,
    prepare: ChangeRequestReviewPreparation,
    prepareProvider: ChangeRequestProviderPreparation,
    project: (row: Row) => T,
  ) {
    const approved = input.action === "approve" && target.row.reviewStatus === "pending",
      recipientIds = [
        ...new Set([
          target.row.submittedByUserId,
          ...target.channel.providers.map((row) => row.userId),
          ...(targets ?? []).map((row) => row.user.id),
        ]),
      ].sort(),
      userIds = [...new Set([...guard.snapshot.users.map((row) => row.id), ...recipientIds])].sort();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(userIds)}) ORDER BY id FOR UPDATE`,
          );
          await assertIamAccountUserMutation(
            tx,
            {
              principal: guard.principal,
              targetUserId: guard.principal.subjectUserId,
              users: guard.snapshot.users,
              recheck: () => guard.recheck(tx),
            },
            guard.principal.subjectUserId,
          );
          await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id=${guard.snapshot.group.id} FOR UPDATE`);
          if (
            !same(
              await platformManagementGroupSnapshot(guard.principal, Permission.RELAY_CHANNEL_REVIEW, tx),
              guard.snapshot.group,
            )
          )
            throw iamAccountDenied();
          const revision = await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id=${target.channel.id} FOR UPDATE`);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM relay_channel_change_requests WHERE id=${target.row.id} FOR UPDATE`,
          );
          if (!same(target, await this.candidate(target.link, tx))) throw iamAccountDenied();
          const readUsers = () =>
              tx.user.findMany({ where: { id: { in: recipientIds } }, select: userSelect, orderBy: { id: "asc" } }),
            users = await readUsers();
          if (
            users.length !== recipientIds.length ||
            targets?.some((target) => !users.some((row) => same(row, target.user)))
          )
            throw iamAccountDenied();
          const readAllProviders = () =>
              tx.relayChannelProvider.findMany({
                where: { relayChannelId: target.channel.id },
                select: providerSelect,
                orderBy: { userId: "asc" },
              }),
            oldProviders = await readAllProviders();
          if (approved)
            await assertRelayChannelChangeProviderBindings(
              tx,
              target.row.configSnapshot,
              targets?.map((row) => row.input),
            );
          await guard.recheck(tx);
          if (!persist) {
            if (
              !same(target, await this.candidate(target.link, tx)) ||
              !same(users, await readUsers()) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
            return undefined;
          }
          let expectedChannel = target.channel,
            expectedRow = target.row,
            expectedProviders = oldProviders;
          let verifyCatalog = async () => {};
          if (target.row.reviewStatus === "pending") {
            const previous = previousState(target.row, target.channel),
              preserve = previous.submissionStatus === "approved";
            const reviewedAt = new Date(),
              reason = input.reason?.trim() || null;
            let patch: Prisma.RelayChannelUncheckedUpdateManyInput = {};
            if (approved) {
              const readCatalog = () =>
                tx.modelPricing.findMany({
                  where: { status: 1 },
                  select: {
                    id: true,
                    status: true,
                    updateTime: true,
                    model: true,
                    provider: true,
                    supportedFormats: true,
                  },
                  orderBy: { id: "asc" },
                });
              const catalog = await readCatalog(),
                flags = (await readRelayChannelCredentialPresence(tx, [target.channel.id])).get(target.channel.id),
                readCredentials = () =>
                  tx.relayChannelChangeRequest.findUnique({
                    where: { id: target.row.id },
                    select: { encryptedCredentials: true, credentialIv: true, credentialAuthTag: true },
                  }),
                credentials = await readCredentials();
              if (!flags || !credentials) throw iamAccountDenied();
              patch = Object.fromEntries(
                Object.entries(await prepare({ ...target.row, ...credentials }, target.channel, flags, catalog)).filter(
                  ([, value]) => value !== undefined,
                ),
              );
              if (typeof patch.name !== "string") throw iamAccountDenied();
              if (
                await tx.relayChannel.findFirst({
                  where: {
                    name: patch.name,
                    id: { not: target.channel.id },
                    status: { in: VISIBLE_RELAY_CHANNEL_STATUSES },
                  },
                  select: { id: true },
                })
              )
                throw new ConflictError("Channel name is unavailable", undefined, {
                  messageKey: "relayChannel.nameExists",
                });
              const expectedFlags = {
                hasOpenaiUpstreamApiKey:
                  typeof patch.openaiUpstreamApiKey === "string"
                    ? Boolean(patch.openaiUpstreamApiKey)
                    : flags.hasOpenaiUpstreamApiKey,
                hasAnthropicUpstreamApiKey:
                  typeof patch.anthropicUpstreamApiKey === "string"
                    ? Boolean(patch.anthropicUpstreamApiKey)
                    : flags.hasAnthropicUpstreamApiKey,
                hasGeminiUpstreamApiKey:
                  typeof patch.geminiUpstreamApiKey === "string"
                    ? Boolean(patch.geminiUpstreamApiKey)
                    : flags.hasGeminiUpstreamApiKey,
              };
              verifyCatalog = async () => {
                if (
                  !same(catalog, await readCatalog()) ||
                  !same(credentials, await readCredentials()) ||
                  !same(
                    expectedFlags,
                    (await readRelayChannelCredentialPresence(tx, [target.channel.id])).get(target.channel.id),
                  )
                )
                  throw iamAccountDenied();
              };
            }
            const lifecycle = {
              submissionStatus: approved ? "approved" : previous.submissionStatus,
              status: preserve ? target.channel.status : approved ? RELAY_CHANNEL_STATUS.ENABLED : previous.status,
              providerServiceEnabled: preserve
                ? target.channel.providerServiceEnabled
                : approved
                  ? true
                  : previous.providerServiceEnabled,
              reviewedByUserId: guard.principal.subjectUserId,
              reviewedAt,
              reviewReason: approved ? null : reason,
            };
            const result = await tx.relayChannel.updateMany({
              where: { id: target.channel.id, updateTime: target.channel.updateTime, status: target.channel.status },
              data: { ...patch, ...lifecycle },
            });
            if (result.count !== 1) throw iamAccountDenied();
            if (approved && targets) {
              const ids = targets.map((row) => row.user.id),
                now = new Date(),
                expected = targets.map((row) => prepareProvider(row.input, row.user.id, now));
              await tx.relayChannelProvider.updateMany({
                where: {
                  relayChannelId: target.channel.id,
                  status: 1,
                  ...(ids.length ? { userId: { notIn: ids } } : {}),
                },
                data: { status: 0 },
              });
              for (const [index, targetProvider] of targets.entries()) {
                const proposed = expected[index]!;
                if (proposed.userId !== targetProvider.user.id) throw iamAccountDenied();
                const { userId, ...configuration } = providerValues(proposed);
                await tx.relayChannelProvider.upsert({
                  where: { relayChannelId_userId: { relayChannelId: target.channel.id, userId } },
                  create: { relayChannelId: target.channel.id, userId, ...configuration },
                  update: { status: 1, ...configuration },
                  select: { id: true },
                });
              }
              expectedProviders = await readAllProviders();
              if (
                expectedProviders.some(
                  (row) => !oldProviders.some((old) => old.id === row.id) && !ids.includes(row.userId),
                ) ||
                expectedProviders.length !== new Set([...oldProviders.map((row) => row.userId), ...ids]).size
              )
                throw iamAccountDenied();
              if (
                !same(
                  expectedProviders.filter((row) => row.status === 1).map(providerValues),
                  expected.map(providerValues),
                )
              )
                throw iamAccountDenied();
              for (const old of oldProviders) {
                const current = expectedProviders.find((row) => row.id === old.id);
                if (
                  !current ||
                  !same(current.lastSettledAt, old.lastSettledAt) ||
                  current.status !== (ids.includes(old.userId) ? 1 : old.status === 1 ? 0 : old.status) ||
                  (!ids.includes(old.userId) &&
                    !same({ ...current, updateTime: old.updateTime, status: old.status }, old))
                )
                  throw iamAccountDenied();
              }
            }
            const review = {
              reviewStatus: approved ? "approved" : "rejected",
              reviewedByUserId: guard.principal.subjectUserId,
              reviewedAt,
              reviewReason: reason,
            };
            const changed = await tx.relayChannelChangeRequest.updateMany({
              where: { id: target.row.id, status: 1, reviewStatus: "pending", updateTime: target.row.updateTime },
              data: review,
            });
            if (changed.count !== 1) throw iamAccountDenied();
            const channel = await tx.relayChannel.findUnique({
                where: { id: target.channel.id },
                select: channelSelect,
              }),
              row = await tx.relayChannelChangeRequest.findUnique({
                where: { id: target.row.id },
                select: publicSelect,
              });
            if (!channel || !row) throw iamAccountDenied();
            const data = { ...patch, ...lifecycle };
            for (const [key, value] of Object.entries(target.channel)) {
              if (key === "updateTime" || key === "providers") continue;
              const expected = key in data ? comparable(data[key as keyof typeof data]) : comparable(value);
              if (!same(comparable(channel[key as keyof typeof channel]), expected)) throw iamAccountDenied();
            }
            if (
              !same(
                {
                  ...row,
                  updateTime: target.row.updateTime,
                  relayChannel: target.row.relayChannel,
                  ...Object.fromEntries(Object.keys(review).map((key) => [key, target.row[key as keyof Row]])),
                },
                target.row,
              ) ||
              row.relayChannel.name !== channel.name ||
              Object.entries(review).some(([key, value]) => !same(row[key as keyof Row], value))
            )
              throw iamAccountDenied();
            expectedChannel = channel;
            expectedRow = row;
          }
          const value = project(expectedRow);
          const verify = async () => {
            await verifyCatalog();
            if (
              !same(
                expectedChannel,
                await tx.relayChannel.findUnique({ where: { id: target.channel.id }, select: channelSelect }),
              ) ||
              !same(
                expectedRow,
                await tx.relayChannelChangeRequest.findUnique({ where: { id: target.row.id }, select: publicSelect }),
              ) ||
              !same(expectedProviders, await readAllProviders()) ||
              !same(users, await readUsers()) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
          };
          await verify();
          await guard.recheck(tx);
          await verify();
          return value;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: reviewPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P2002"].includes(error.code))
        throw new ConflictError("Channel change review context changed", undefined, { messageKey: "errors.conflict" });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Channel change review failed", undefined, {
        messageKey: "errors.internalServerError",
      });
    }
  }
}
