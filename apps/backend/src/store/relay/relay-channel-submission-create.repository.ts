import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { ApiError, BadRequestError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { relayChannelConfigurationReadSelect } from "./relay-channel-configuration-read.repository";
import { readRelayChannelCredentialPresence } from "./relay-channel-credential-presence";
import type { RelayChannelProviderConfigRequest, SubmitRelayChannelRequest } from "@/api/dto/relay/relay-channel.dto";
import type {
  RelayChannelConfigurationSource,
  RelayChannelCredentialPresence,
} from "@/services/relay/relay-channel-configuration-projection";
import type { RelayModelCatalogEntry, RelayPoolResolverContext } from "@/services/relay/relay-pool-resolver.service";
const creationPolicy = Object.freeze({ timeoutMs: 30000 });
const providerSelect = { id: true, status: true, username: true, accountOwnerId: true, updateTime: true } as const;
type ProviderUser = Prisma.UserGetPayload<{ select: typeof providerSelect }>;
export interface SubmissionProviderTarget {
  user: ProviderUser;
  input?: RelayChannelProviderConfigRequest;
}
export type SubmissionProviderInput = Omit<RelayChannelProviderConfigRequest, "username"> & {
  userId: string;
  nextSettlementAt?: Date | null;
};
export interface SubmissionCreatePreparation {
  channel: (
    input: SubmitRelayChannelRequest,
    catalog: readonly RelayModelCatalogEntry[],
  ) => Promise<Prisma.RelayChannelUncheckedCreateInput>;
  provider: (input: RelayChannelProviderConfigRequest, userId: string, now: Date) => SubmissionProviderInput;
}
interface Guard {
  principal: IamPrincipal;
  users: readonly { id: string; updateTime: Date }[];
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
export class RelayChannelSubmissionCreateRepository {
  private static instance: RelayChannelSubmissionCreateRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelSubmissionCreateRepository());
  }
  async providers(
    principal: IamPrincipal,
    inputs: readonly RelayChannelProviderConfigRequest[],
  ): Promise<SubmissionProviderTarget[]> {
    const targets: SubmissionProviderTarget[] = [];
    for (const input of inputs) {
      const user = await prisma.user.findUnique({ where: { username: input.username }, select: providerSelect });
      if (!user || user.status !== 1)
        throw new BadRequestError("Channel provider username is unavailable", undefined, {
          messageKey: "relayChannel.providerUsernameUnavailable",
        });
      targets.push({ user, input });
    }
    if (new Set(targets.map((target) => target.user.id)).size !== targets.length)
      throw new BadRequestError("Channel providers must be unique", undefined, {
        messageKey: "relayChannel.providersUnique",
      });
    if (!targets.some((target) => target.user.id === principal.subjectUserId)) {
      const user = await prisma.user.findUnique({ where: { id: principal.subjectUserId }, select: providerSelect });
      if (!user || user.id !== principal.subjectUserId || user.status !== 1) throw iamAccountDenied();
      targets.push({ user });
    }
    return targets.sort((a, b) => a.user.id.localeCompare(b.user.id));
  }
  async create<T>(
    id: string,
    input: SubmitRelayChannelRequest,
    targets: readonly SubmissionProviderTarget[],
    guard: Guard,
    prepare: SubmissionCreatePreparation,
    persist: boolean,
    project: (
      source: RelayChannelConfigurationSource,
      presence: RelayChannelCredentialPresence,
      context: RelayPoolResolverContext,
    ) => Promise<T>,
  ): Promise<T | undefined> {
    const userIds = [
      ...new Set([...guard.users.map((user) => user.id), ...targets.map((target) => target.user.id)]),
    ].sort();
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Lock all referenced identities in one order, including cross-account proposed revenue recipients.
          // A proposal is owned by the submitter; it never confers authority over a recipient's IAM identity.
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
          const verifyProviders = async () => {
            const users = await tx.user.findMany({
              where: { id: { in: targets.map((target) => target.user.id) } },
              select: providerSelect,
              orderBy: { id: "asc" },
            });
            if (
              !same(
                users,
                targets.map((target) => target.user),
              )
            )
              throw iamAccountDenied();
          };
          const nameMatches = () =>
            tx.relayChannel.findMany({
              where: { name: input.name, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
              select: { id: true },
              orderBy: { id: "asc" },
            });
          if ((await nameMatches()).length)
            throw new ConflictError("Relay channel name already exists", undefined, {
              messageKey: "relayChannel.nameExists",
            });
          if (await tx.relayChannel.findUnique({ where: { id }, select: { id: true } })) throw iamAccountDenied();
          await verifyProviders();
          await guard.recheck(tx);
          if (!persist) {
            if (
              (await nameMatches()).length ||
              (await tx.relayChannel.findUnique({ where: { id }, select: { id: true } }))
            )
              throw iamAccountDenied();
            await verifyProviders();
            await guard.recheck(tx);
            if ((await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision)
              throw iamAccountDenied();
            return undefined;
          }
          const readCatalog = () =>
            tx.modelPricing.findMany({
              where: { status: 1 },
              select: { id: true, status: true, updateTime: true, model: true, provider: true, supportedFormats: true },
              orderBy: { id: "asc" },
            });
          const catalog = await readCatalog(),
            prepared = await prepare.channel(input, catalog);
          if (prepared.name !== input.name || prepared.channelType !== "standalone" || prepared.pooledParentId)
            throw iamAccountDenied();
          await guard.recheck(tx);
          await verifyProviders();
          const created = await tx.relayChannel.create({
            data: {
              ...prepared,
              id,
              status: RELAY_CHANNEL_STATUS.DISABLED,
              channelType: "standalone",
              providerServiceEnabled: true,
              submissionStatus: "pending",
              submittedByUserId: guard.principal.subjectUserId,
              reviewedByUserId: null,
              reviewedAt: null,
              reviewReason: null,
            },
            select: { id: true },
          });
          if (created.id !== id) throw iamAccountDenied();
          const now = new Date(),
            expectedProviders: SubmissionProviderInput[] = [];
          for (const target of targets) {
            const entry: SubmissionProviderInput = target.input
              ? prepare.provider(target.input, target.user.id, now)
              : { userId: target.user.id, commissionPercent: 0, settlementMode: "manual", nextSettlementAt: null };
            if (entry.userId !== target.user.id) throw iamAccountDenied();
            const {
              userId,
              commissionPercent,
              settlementMode,
              settlementIntervalDays,
              settlementTime,
              nextSettlementAt,
            } = entry;
            expectedProviders.push(entry);
            await tx.relayChannelProvider.create({
              data: {
                relayChannelId: id,
                userId,
                commissionPercent,
                settlementMode,
                settlementIntervalDays,
                settlementTime,
                nextSettlementAt,
              },
              select: { id: true },
            });
          }
          const read = () =>
            tx.relayChannel.findUnique({
              where: { id },
              select: { ...relayChannelConfigurationReadSelect, reviewedByUserId: true },
            });
          const source = await read(),
            presence = await readRelayChannelCredentialPresence(tx, [id]),
            flags = presence.get(id);
          if (
            !source ||
            source.id !== id ||
            source.name !== input.name ||
            source.submittedByUserId !== guard.principal.subjectUserId ||
            source.channelType !== "standalone" ||
            source.pooledParentId ||
            source.status !== RELAY_CHANNEL_STATUS.DISABLED ||
            source.submissionStatus !== "pending" ||
            source.providerServiceEnabled !== true ||
            source.reviewedByUserId ||
            source.reviewedAt ||
            source.reviewReason ||
            !flags ||
            !same(flags, {
              hasOpenaiUpstreamApiKey: Boolean(prepared.openaiUpstreamApiKey),
              hasAnthropicUpstreamApiKey: Boolean(prepared.anthropicUpstreamApiKey),
              hasGeminiUpstreamApiKey: Boolean(prepared.geminiUpstreamApiKey),
            })
          )
            throw iamAccountDenied();
          const persistedProviders = source.providers
            .map((row) => ({
              userId: row.userId,
              commissionPercent: Number(row.commissionPercent),
              settlementMode: row.settlementMode,
              settlementIntervalDays: row.settlementIntervalDays ?? null,
              settlementTime: row.settlementTime ?? null,
              nextSettlementAt: row.nextSettlementAt ?? null,
            }))
            .sort((a, b) => a.userId.localeCompare(b.userId));
          if (
            !same(
              persistedProviders,
              expectedProviders
                .map((row) => ({
                  userId: row.userId,
                  // Match the persisted Decimal(10, 6) scale, including its existing rounding behavior.
                  commissionPercent: Number(
                    new Prisma.Decimal(row.commissionPercent).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP),
                  ),
                  settlementMode: row.settlementMode,
                  settlementIntervalDays: row.settlementIntervalDays ?? null,
                  settlementTime: row.settlementTime ?? null,
                  nextSettlementAt: row.nextSettlementAt ?? null,
                }))
                .sort((a, b) => a.userId.localeCompare(b.userId)),
            )
          )
            throw iamAccountDenied();
          const result = await project(
            { ...source, pooledParentId: null, pooledParent: null, poolMembers: [], pooledChildren: [] },
            flags,
            { graph: new Map([[id, { ...source, poolMembers: [] }]]), modelCatalog: catalog, includeDisabled: true },
          );
          const verify = async () => {
            if (
              !same(source, await read()) ||
              !same(presence, await readRelayChannelCredentialPresence(tx, [id])) ||
              !same(catalog, await readCatalog()) ||
              !same(await nameMatches(), [{ id }])
            )
              throw iamAccountDenied();
            await verifyProviders();
          };
          await verify();
          await guard.recheck(tx);
          await verify();
          if ((await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision)
            throw iamAccountDenied();
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: creationPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P2002"].includes(error.code))
        throw new ConflictError("Submission creation context changed", undefined, { messageKey: "errors.conflict" });
      if (error instanceof ApiError) throw error;
      // Prisma errors can embed the create invocation, including supplied credentials. Never propagate their text/cause.
      throw new InternalServerError("Channel submission creation failed", undefined, {
        messageKey: "errors.internalServerError",
      });
    }
  }
}
