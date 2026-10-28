import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { RELAY_CHANNEL_STATUS, VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { ApiError, BadRequestError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import type { ReviewRelayChannelSubmissionRequest } from "@/api/dto/relay/relay-channel.dto";
const reviewPolicy = Object.freeze({ timeoutMs: 30000 });
const select = {
  id: true,
  status: true,
  updateTime: true,
  submissionStatus: true,
  submittedByUserId: true,
  providerServiceEnabled: true,
  providers: {
    where: { status: 1 },
    select: {
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
    },
    orderBy: { userId: "asc" },
  },
} as const satisfies Prisma.RelayChannelSelect;
const userSelect = { id: true, status: true, updateTime: true, accountOwnerId: true, username: true } as const;
type Target = Prisma.RelayChannelGetPayload<{ select: typeof select }>;
interface Guard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
export class RelayChannelSubmissionReviewRepository {
  private static instance: RelayChannelSubmissionReviewRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelSubmissionReviewRepository());
  }
  async candidate(id: string, tx: Prisma.TransactionClient = prisma) {
    const row = await tx.relayChannel.findFirst({
      where: { id, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
      select,
    });
    if (!row || row.id !== id) throw iamAccountDenied();
    if (!row.submittedByUserId)
      throw new BadRequestError("Only submitted channels may be reviewed", undefined, {
        messageKey: "relayChannel.reviewSubmittedOnly",
      });
    return row;
  }
  async apply<T>(
    target: Target,
    input: ReviewRelayChannelSubmissionRequest,
    guard: Guard,
    persist: boolean,
    project: (tx: Prisma.TransactionClient) => Promise<{ value: T; verify: () => Promise<void> }>,
  ) {
    const approved = input.action === "approve",
      recipientIds = [...new Set([...target.providers.map((row) => row.userId), target.submittedByUserId!])].sort(),
      userIds = [...new Set([...guard.snapshot.users.map((row) => row.id), ...recipientIds])].sort();
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Proposals can pay other accounts. Lock all referenced identities once, in canonical order.
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
          await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id=${target.id} FOR UPDATE`);
          if (!same(target, await this.candidate(target.id, tx))) throw iamAccountDenied();
          const readUsers = () =>
            tx.user.findMany({ where: { id: { in: recipientIds } }, select: userSelect, orderBy: { id: "asc" } });
          const recipients = await readUsers();
          if (recipients.length !== recipientIds.length || recipients.some((row) => !recipientIds.includes(row.id)))
            throw iamAccountDenied();
          const pending = () =>
            tx.relayChannelChangeRequest.findMany({
              where: { relayChannelId: target.id, status: 1, reviewStatus: "pending" },
              select: { id: true },
              orderBy: { id: "asc" },
            });
          if ((await pending()).length)
            throw new ConflictError("Pending changes block submission review", undefined, {
              messageKey: "relayChannel.pendingChangeRequestBlocksReview",
            });
          await guard.recheck(tx);
          if (!persist) {
            if (
              !same(target, await this.candidate(target.id, tx)) ||
              !same(recipients, await readUsers()) ||
              (await pending()).length
            )
              throw iamAccountDenied();
            await guard.recheck(tx);
            if ((await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision)
              throw iamAccountDenied();
            return undefined;
          }
          const reviewedAt = new Date(),
            status = approved ? RELAY_CHANNEL_STATUS.ENABLED : RELAY_CHANNEL_STATUS.DISABLED,
            submissionStatus = approved ? "approved" : input.action === "reject" ? "rejected" : "offboarded",
            reason = input.reason?.trim() || null;
          const result = await tx.relayChannel.updateMany({
            where: {
              id: target.id,
              status: target.status,
              updateTime: target.updateTime,
              submittedByUserId: target.submittedByUserId,
            },
            data: {
              status,
              submissionStatus,
              reviewedByUserId: guard.principal.subjectUserId,
              reviewedAt,
              reviewReason: reason,
              ...(approved ? { providerServiceEnabled: true } : {}),
            },
          });
          if (result.count !== 1) throw iamAccountDenied();
          if (approved && !target.providers.some((row) => row.userId === target.submittedByUserId)) {
            // Preserve the legacy approval rule: adding the implicit submitter resets existing settlement schedules.
            await tx.relayChannelProvider.updateMany({
              where: { relayChannelId: target.id, status: 1 },
              data: { nextSettlementAt: null },
            });
            await tx.relayChannelProvider.upsert({
              where: { relayChannelId_userId: { relayChannelId: target.id, userId: target.submittedByUserId! } },
              create: {
                relayChannelId: target.id,
                userId: target.submittedByUserId!,
                commissionPercent: 0,
                settlementMode: "manual",
              },
              update: {
                status: 1,
                commissionPercent: 0,
                settlementMode: "manual",
                settlementIntervalDays: null,
                settlementTime: null,
                nextSettlementAt: null,
              },
              select: { id: true },
            });
          }
          const read = () =>
            tx.relayChannel.findUnique({
              where: { id: target.id },
              select: { ...select, reviewedAt: true, reviewedByUserId: true, reviewReason: true },
            });
          const source = await read(),
            expectedRecipients = approved ? recipientIds : target.providers.map((row) => row.userId).sort();
          if (
            !source ||
            source.status !== status ||
            source.submissionStatus !== submissionStatus ||
            source.submittedByUserId !== target.submittedByUserId ||
            source.reviewedByUserId !== guard.principal.subjectUserId ||
            source.reviewedAt?.getTime() !== reviewedAt.getTime() ||
            source.reviewReason !== reason ||
            source.providerServiceEnabled !== (approved ? true : target.providerServiceEnabled) ||
            !same(source.providers.map((row) => row.userId).sort(), expectedRecipients)
          )
            throw iamAccountDenied();
          // Review may only reset schedules under the documented implicit-submitter rule, not rewrite shares.
          for (const old of target.providers) {
            const current = source.providers.find((row) => row.id === old.id);
            if (
              !current ||
              !same(
                { ...current, updateTime: old.updateTime },
                {
                  ...old,
                  ...(approved && !target.providers.some((row) => row.userId === target.submittedByUserId)
                    ? { nextSettlementAt: null }
                    : {}),
                },
              )
            )
              throw iamAccountDenied();
          }
          const projection = await project(tx);
          const verify = async () => {
            await projection.verify();
            if (
              !same(source, await read()) ||
              !same(recipients, await readUsers()) ||
              (await pending()).length ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
          };
          await verify();
          await guard.recheck(tx);
          await verify();
          return projection.value;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: reviewPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P2002"].includes(error.code))
        throw new ConflictError("Channel review context changed", undefined, { messageKey: "errors.conflict" });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Channel review failed", undefined, { messageKey: "errors.internalServerError" });
    }
  }
}
