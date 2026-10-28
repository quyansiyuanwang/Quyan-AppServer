import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { BadRequestError, ConflictError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { relayChannelConfigurationReadSelect } from "./relay-channel-configuration-read.repository";
import { readRelayChannelCredentialPresence } from "./relay-channel-credential-presence";
import type {
  RelayChannelConfigurationSource,
  RelayChannelCredentialPresence,
} from "@/services/relay/relay-channel-configuration-projection";
import type { RelayPoolResolverContext } from "@/services/relay/relay-pool-resolver.service";
const mutationPolicy = Object.freeze({ timeoutMs: 30000 });
const metadataSelect = {
  id: true,
  status: true,
  updateTime: true,
  submittedByUserId: true,
  submissionStatus: true,
  channelType: true,
  providerServiceEnabled: true,
} as const;
type Target = Prisma.RelayChannelGetPayload<{ select: typeof metadataSelect }>;
export type SubmissionMutation = { operation: "delete" } | { operation: "service-status"; enabled: boolean };
interface Guard {
  principal: IamPrincipal;
  users: readonly { id: string; updateTime: Date }[];
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
export class RelayChannelSubmissionMutationRepository {
  private static instance: RelayChannelSubmissionMutationRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelSubmissionMutationRepository());
  }
  async target(principal: IamPrincipal, id: string, tx: Prisma.TransactionClient = prisma) {
    const row = await tx.relayChannel.findFirst({
      where: { id, submittedByUserId: principal.subjectUserId, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
      select: metadataSelect,
    });
    if (!row || row.id !== id || row.submittedByUserId !== principal.subjectUserId) throw iamAccountDenied();
    return row;
  }
  async apply<T>(
    target: Target,
    input: SubmissionMutation,
    guard: Guard,
    persist: boolean,
    project: (
      source: RelayChannelConfigurationSource,
      presence: RelayChannelCredentialPresence,
      context: RelayPoolResolverContext,
    ) => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await prisma.$transaction(
        async (tx) => {
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
          await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id=${target.id} FOR UPDATE`);
          if (!same(await this.target(guard.principal, target.id, tx), target)) throw iamAccountDenied();
          // A provider submission is standalone. Historical pool records must not grant topology-management authority.
          if (target.channelType !== "standalone") throw iamAccountDenied();
          if (input.operation === "delete") {
            if (!["pending", "rejected", "offboarded"].includes(target.submissionStatus))
              throw new BadRequestError("Only pending, rejected, or offboarded submissions may be deleted", undefined, {
                messageKey: "relayChannel.deleteStateInvalid",
              });
          } else {
            if (target.submissionStatus !== "approved")
              throw new BadRequestError("Only approved submissions may update service status", undefined, {
                messageKey: "relay.providerServiceApprovalRequired",
              });
            if (input.enabled && target.status !== RELAY_CHANNEL_STATUS.ENABLED)
              throw new ConflictError("The administrator has disabled this channel", undefined, {
                messageKey: "relay.providerServiceAdminDisabled",
              });
          }
          await guard.recheck(tx);
          if (!persist) return undefined; // Shadow compares metadata and authority only; never hydrates or writes twice.
          const result = await tx.relayChannel.updateMany({
            where: { ...target },
            data:
              input.operation === "delete"
                ? { status: RELAY_CHANNEL_STATUS.DELETED }
                : { providerServiceEnabled: input.enabled },
          });
          if (result.count !== 1) throw iamAccountDenied();
          let projection: T | undefined;
          let verify: () => Promise<void>;
          if (input.operation === "delete") {
            // Preserve mandatory reference cleanup in this same transaction, without reading any token values.
            await tx.relayToken.updateMany({ where: { channelId: target.id }, data: { channelId: null } });
            await tx.relayToken.updateMany({
              where: { automaticProxyPoolChannelId: target.id },
              data: { automaticProxyPoolChannelId: null, routingMode: "ordered" },
            });
            await tx.relayTokenChannelConfig.deleteMany({ where: { channelId: target.id } });
            await tx.relayChannelMember.deleteMany({
              where: { OR: [{ relayChannelId: target.id }, { memberChannelId: target.id }] },
            });
            await tx.relayChannelChangeRequest.updateMany({
              where: { relayChannelId: target.id, status: 1 },
              data: { status: -1 },
            });
            const deleted = await tx.relayChannel.findUnique({ where: { id: target.id }, select: metadataSelect });
            if (
              !deleted ||
              !same({ ...deleted, updateTime: target.updateTime }, { ...target, status: RELAY_CHANNEL_STATUS.DELETED })
            )
              throw iamAccountDenied();
            verify = async () => {
              if (
                !same(deleted, await tx.relayChannel.findUnique({ where: { id: target.id }, select: metadataSelect }))
              )
                throw iamAccountDenied();
            };
          } else {
            const read = () =>
              tx.relayChannel.findFirst({
                where: {
                  id: target.id,
                  submittedByUserId: guard.principal.subjectUserId,
                  status: { in: VISIBLE_RELAY_CHANNEL_STATUSES },
                },
                select: relayChannelConfigurationReadSelect,
              });
            const source = await read();
            if (
              !source ||
              source.id !== target.id ||
              source.status !== target.status ||
              source.submittedByUserId !== target.submittedByUserId ||
              source.submissionStatus !== target.submissionStatus ||
              source.channelType !== target.channelType ||
              source.providerServiceEnabled !== input.enabled
            )
              throw iamAccountDenied();
            const presence = await readRelayChannelCredentialPresence(tx, [target.id]);
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
              flags = presence.get(target.id);
            if (!flags) throw iamAccountDenied();
            projection = await project(
              { ...source, pooledParentId: null, pooledParent: null, poolMembers: [], pooledChildren: [] },
              flags,
              {
                graph: new Map([[source.id, { ...source, poolMembers: [] }]]),
                modelCatalog: catalog,
                includeDisabled: true,
              },
            );
            verify = async () => {
              if (
                !same(source, await read()) ||
                !same(presence, await readRelayChannelCredentialPresence(tx, [target.id])) ||
                !same(catalog, await readCatalog())
              )
                throw iamAccountDenied();
            };
          }
          await verify();
          await guard.recheck(tx);
          await verify();
          if ((await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision)
            throw iamAccountDenied();
          return projection;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: mutationPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028"].includes(error.code))
        throw new ConflictError("Submission authorization context changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}
