import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { ApiError, BadRequestError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { readRelayChannelCredentialPresence } from "./relay-channel-credential-presence";
import { RelayChannelProviderConfigRepository } from "./relay-channel-provider-config.repository";
import { relayChannelChangeRequestPublicSelect } from "./relay-channel-change-request-read.repository";
import type { CreateRelayChannelChangeRequest } from "@/api/dto/relay/relay-channel.dto";
import type { RelayChannelCredentialPresence } from "@/services/relay/relay-channel-configuration-projection";
import type { RelayModelCatalogEntry } from "@/services/relay/relay-pool-resolver.service";
const creationPolicy = Object.freeze({ timeoutMs: 30000 });
const metadataSelect = {
  id: true,
  status: true,
  updateTime: true,
  channelType: true,
  submittedByUserId: true,
  submissionStatus: true,
  providerServiceEnabled: true,
} as const;
const sourceSelect = {
  ...metadataSelect,
  name: true,
  routingStrategy: true,
  routingConfig: true,
  visibilityMode: true,
  visibilityConfig: true,
  pooledParentId: true,
  pooledPriority: true,
  pooledWeight: true,
  pooledMemberEnabled: true,
  openaiUpstreamUrl: true,
  anthropicUpstreamUrl: true,
  geminiUpstreamUrl: true,
  useProxy: true,
  multiplier: true,
  allowedFormats: true,
  allowedModels: true,
  addUserIdentifier: true,
  inputTokensIncludeCacheRead: true,
  modelMapping: true,
  timePeriodMultipliers: true,
  contextLengthMultipliers: true,
  reviewedByUserId: true,
  reviewedAt: true,
  reviewReason: true,
} as const satisfies Prisma.RelayChannelSelect;
const pendingSelect = {
  id: true,
  relayChannelId: true,
  submittedByUserId: true,
  status: true,
  reviewStatus: true,
  updateTime: true,
  reviewReason: true,
  reviewedAt: true,
} as const;
type Metadata = Prisma.RelayChannelGetPayload<{ select: typeof metadataSelect }>;
type Source = Prisma.RelayChannelGetPayload<{ select: typeof sourceSelect }>;
type Pending = Prisma.RelayChannelChangeRequestGetPayload<{ select: typeof pendingSelect }>;
type Providers = Awaited<ReturnType<RelayChannelProviderConfigRepository["providers"]>>;
export type ChangeRequestPreparation = (
  input: CreateRelayChannelChangeRequest,
  source: Source,
  presence: RelayChannelCredentialPresence,
  catalog: readonly RelayModelCatalogEntry[],
) => Promise<{
  snapshot: Prisma.InputJsonObject;
  encrypted?: { ciphertext: string; iv: string; authTag: string };
}>;
interface Guard {
  principal: IamPrincipal;
  users: readonly { id: string; updateTime: Date }[];
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
export class RelayChannelChangeRequestCreateRepository {
  private static instance: RelayChannelChangeRequestCreateRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelChangeRequestCreateRepository());
  }
  private pending(channelId: string, tx: Prisma.TransactionClient = prisma) {
    return tx.relayChannelChangeRequest.findMany({
      where: { relayChannelId: channelId, status: 1, reviewStatus: "pending" },
      select: pendingSelect,
      orderBy: { id: "asc" },
    });
  }
  async candidate(principal: IamPrincipal, id: string, tx: Prisma.TransactionClient = prisma) {
    const channel = await tx.relayChannel.findFirst({
      where: { id, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
      select: metadataSelect,
    });
    if (!channel || channel.id !== id || channel.submittedByUserId !== principal.subjectUserId)
      throw iamAccountDenied();
    if (channel.channelType !== "standalone" || !["pending", "approved", "rejected"].includes(channel.submissionStatus))
      throw new BadRequestError("Invalid channel change-request state", undefined, {
        messageKey: "relayChannel.changeRequestStateInvalid",
      });
    const pending = await this.pending(id, tx);
    if (pending.some((row) => row.relayChannelId !== id || row.submittedByUserId !== principal.subjectUserId))
      throw iamAccountDenied();
    return { channel, pending };
  }
  async providers(input: CreateRelayChannelChangeRequest): Promise<Providers | undefined> {
    return input.providers === undefined
      ? undefined
      : RelayChannelProviderConfigRepository.getInstance().providers(input.providers);
  }
  async create<T>(
    id: string,
    target: { channel: Metadata; pending: Pending[] },
    input: CreateRelayChannelChangeRequest,
    providers: Providers | undefined,
    guard: Guard,
    prepare: ChangeRequestPreparation,
    persist: boolean,
    project: (
      row: Prisma.RelayChannelChangeRequestGetPayload<{ select: typeof relayChannelChangeRequestPublicSelect }>,
    ) => T,
  ): Promise<T | undefined> {
    const userIds = [
      ...new Set([...guard.users.map((row) => row.id), ...(providers ?? []).map((row) => row.user.id)]),
    ].sort();
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
              users: guard.users,
              targetUserId: guard.principal.subjectUserId,
              recheck: () => guard.recheck(tx),
            },
            guard.principal.subjectUserId,
          );
          const revision = await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id=${target.channel.id} FOR UPDATE`);
          if (!same(target, await this.candidate(guard.principal, target.channel.id, tx))) throw iamAccountDenied();
          const verifyProviders = async () => {
            if (!providers?.length) return;
            const users = await tx.user.findMany({
              where: { id: { in: providers.map((row) => row.user.id) } },
              select: { id: true, status: true, updateTime: true, accountOwnerId: true, username: true },
              orderBy: { id: "asc" },
            });
            if (
              !same(
                users,
                providers.map((row) => row.user),
              )
            )
              throw iamAccountDenied();
          };
          await verifyProviders();
          await guard.recheck(tx);
          if (await tx.relayChannelChangeRequest.findUnique({ where: { id }, select: { id: true } }))
            throw iamAccountDenied();
          if (!persist) {
            if (!same(target, await this.candidate(guard.principal, target.channel.id, tx))) throw iamAccountDenied();
            await verifyProviders();
            await guard.recheck(tx);
            if ((await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision)
              throw iamAccountDenied();
            return undefined;
          }
          const readSource = () =>
            tx.relayChannel.findUnique({ where: { id: target.channel.id }, select: sourceSelect });
          const source = await readSource(),
            flags = (await readRelayChannelCredentialPresence(tx, [target.channel.id])).get(target.channel.id);
          if (!source || !flags) throw iamAccountDenied();
          const readCatalog = () =>
            tx.modelPricing.findMany({
              where: { status: 1 },
              select: { id: true, status: true, updateTime: true, model: true, provider: true, supportedFormats: true },
              orderBy: { id: "asc" },
            });
          const catalog = await readCatalog(),
            prepared = await prepare(input, source, flags, catalog);
          // Persist the admitted recipient identity, not a username which could be reinterpreted at approval time.
          const snapshot: Prisma.InputJsonObject = {
            ...prepared.snapshot,
            ...(providers
              ? {
                  providers: providers.map(({ user, input }) => ({ ...input, username: user.username })),
                  providerBindings: providers.map(({ user }) => ({ userId: user.id, username: user.username })),
                }
              : {}),
          };
          await guard.recheck(tx);
          await verifyProviders();
          const now = new Date(),
            pendingIds = target.pending.map((row) => row.id);
          if (pendingIds.length) {
            const changed = await tx.relayChannelChangeRequest.updateMany({
              where: { id: { in: pendingIds }, status: 1, reviewStatus: "pending" },
              data: { status: -1, reviewReason: "Superseded by a new submission", reviewedAt: now },
            });
            if (changed.count !== pendingIds.length) throw iamAccountDenied();
          }
          if (source.submissionStatus === "rejected") {
            const changed = await tx.relayChannel.updateMany({
              where: {
                id: source.id,
                submittedByUserId: guard.principal.subjectUserId,
                status: source.status,
                updateTime: source.updateTime,
                submissionStatus: "rejected",
              },
              data: { submissionStatus: "pending", status: RELAY_CHANNEL_STATUS.DISABLED, reviewReason: null },
            });
            if (changed.count !== 1) throw iamAccountDenied();
          }
          const created = await tx.relayChannelChangeRequest.create({
            data: {
              id,
              relayChannelId: source.id,
              submittedByUserId: guard.principal.subjectUserId,
              reviewStatus: "pending",
              configSnapshot: snapshot,
              encryptedCredentials: prepared.encrypted?.ciphertext,
              credentialIv: prepared.encrypted?.iv,
              credentialAuthTag: prepared.encrypted?.authTag,
            },
            select: { id: true },
          });
          if (created.id !== id) throw iamAccountDenied();
          const read = () =>
            tx.relayChannelChangeRequest.findUnique({ where: { id }, select: relayChannelChangeRequestPublicSelect });
          const row = await read(),
            afterSource = await readSource();
          if (
            !row ||
            !afterSource ||
            row.id !== id ||
            row.status !== 1 ||
            row.reviewStatus !== "pending" ||
            row.relayChannelId !== source.id ||
            row.submittedByUserId !== guard.principal.subjectUserId ||
            !same(row.configSnapshot, snapshot) ||
            !same(
              {
                ...afterSource,
                updateTime: source.updateTime,
                ...(source.submissionStatus === "rejected"
                  ? {
                      submissionStatus: source.submissionStatus,
                      status: source.status,
                      reviewReason: source.reviewReason,
                    }
                  : {}),
              },
              source,
            )
          )
            throw iamAccountDenied();
          if (
            source.submissionStatus === "rejected" &&
            (afterSource.submissionStatus !== "pending" ||
              afterSource.status !== RELAY_CHANNEL_STATUS.DISABLED ||
              afterSource.reviewReason !== null)
          )
            throw iamAccountDenied();
          const readSuperseded = () =>
            pendingIds.length
              ? tx.relayChannelChangeRequest.findMany({
                  where: { id: { in: pendingIds } },
                  select: pendingSelect,
                  orderBy: { id: "asc" },
                })
              : Promise.resolve([]);
          const superseded = await readSuperseded();
          if (
            superseded.length !== pendingIds.length ||
            superseded.some(
              (old, i) =>
                old.id !== pendingIds[i] ||
                old.status !== -1 ||
                old.reviewStatus !== "pending" ||
                old.reviewReason !== "Superseded by a new submission" ||
                !same(old.reviewedAt, now),
            )
          )
            throw iamAccountDenied();
          const value = project(row);
          const verify = async () => {
            if (
              !same(row, await read()) ||
              !same(afterSource, await readSource()) ||
              !same(superseded, await readSuperseded()) ||
              !same(await this.pending(source.id, tx), [
                {
                  id: row.id,
                  relayChannelId: row.relayChannelId,
                  submittedByUserId: row.submittedByUserId,
                  status: row.status,
                  reviewStatus: row.reviewStatus,
                  updateTime: row.updateTime,
                  reviewReason: row.reviewReason,
                  reviewedAt: row.reviewedAt,
                },
              ]) ||
              !same(flags, (await readRelayChannelCredentialPresence(tx, [source.id])).get(source.id)) ||
              !same(catalog, await readCatalog()) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
            const encrypted = prepared.encrypted;
            if (
              (await tx.relayChannelChangeRequest.count({
                where: {
                  id,
                  encryptedCredentials: encrypted?.ciphertext ?? null,
                  credentialIv: encrypted?.iv ?? null,
                  credentialAuthTag: encrypted?.authTag ?? null,
                },
              })) !== 1
            )
              throw iamAccountDenied();
            await verifyProviders();
          };
          await verify();
          await guard.recheck(tx);
          await verify();
          return value;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: creationPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P2002"].includes(error.code))
        throw new ConflictError("Channel change-request context changed", undefined, { messageKey: "errors.conflict" });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Channel change-request creation failed", undefined, {
        messageKey: "errors.internalServerError",
      });
    }
  }
}
