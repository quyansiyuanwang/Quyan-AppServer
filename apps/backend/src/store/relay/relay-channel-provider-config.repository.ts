import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { ApiError, BadRequestError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import type {
  UpdateRelayChannelProviderConfigRequest,
  RelayChannelProviderConfigRequest,
} from "@/api/dto/relay/relay-channel.dto";
import type { SubmissionProviderInput } from "./relay-channel-submission-create.repository";
const configurationPolicy = Object.freeze({ timeoutMs: 30000 });
const eligibility = [Permission.RELAY_CHANNEL_REVIEW, Permission.RELAY_CHANNEL_UPDATE] as const;
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
const select = {
  id: true,
  status: true,
  updateTime: true,
  multiplier: true,
  submittedByUserId: true,
  submissionStatus: true,
  providerServiceEnabled: true,
  providers: { where: { status: 1 }, select: providerSelect, orderBy: { userId: "asc" } },
} as const satisfies Prisma.RelayChannelSelect;
const userSelect = { id: true, status: true, updateTime: true, accountOwnerId: true, username: true } as const;
type Target = Prisma.RelayChannelGetPayload<{ select: typeof select }>;
type ProviderTarget = {
  user: Prisma.UserGetPayload<{ select: typeof userSelect }>;
  input: RelayChannelProviderConfigRequest;
};
interface Guard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
const values = (row: {
  userId: string;
  commissionPercent: Prisma.Decimal | number;
  settlementMode: string;
  settlementIntervalDays?: number | null;
  settlementTime?: string | null;
  nextSettlementAt?: Date | null;
}) => ({
  userId: row.userId,
  commissionPercent: Number(new Prisma.Decimal(row.commissionPercent).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)),
  settlementMode: row.settlementMode,
  settlementIntervalDays: row.settlementIntervalDays ?? null,
  settlementTime: row.settlementTime ?? null,
  nextSettlementAt: row.nextSettlementAt ?? null,
});
export class RelayChannelProviderConfigRepository {
  private static instance: RelayChannelProviderConfigRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelProviderConfigRepository());
  }
  async candidate(id: string, tx: Prisma.TransactionClient = prisma) {
    const row = await tx.relayChannel.findFirst({
      where: { id, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
      select,
    });
    if (!row || row.id !== id) throw iamAccountDenied();
    return row;
  }
  async providers(inputs: readonly RelayChannelProviderConfigRequest[]): Promise<ProviderTarget[]> {
    const targets: ProviderTarget[] = [];
    for (const input of inputs) {
      const user = await prisma.user.findUnique({ where: { username: input.username }, select: userSelect });
      if (!user || user.status !== 1)
        throw new BadRequestError("Channel provider username is unavailable", undefined, {
          messageKey: "relayChannel.providerUsernameUnavailable",
        });
      targets.push({ user, input });
    }
    if (new Set(targets.map((row) => row.user.id)).size !== targets.length)
      throw new BadRequestError("Channel providers must be unique", undefined, {
        messageKey: "relayChannel.providersUnique",
      });
    return targets.sort((a, b) => a.user.id.localeCompare(b.user.id));
  }
  async apply<T>(
    target: Target,
    input: UpdateRelayChannelProviderConfigRequest,
    targets: readonly ProviderTarget[] | undefined,
    guard: Guard,
    persist: boolean,
    prepare: (input: RelayChannelProviderConfigRequest, userId: string, now: Date) => SubmissionProviderInput,
    project: (tx: Prisma.TransactionClient) => Promise<{ value: T; verify: () => Promise<void> }>,
  ) {
    const recipientIds = [
        ...new Set([...target.providers.map((row) => row.userId), ...(targets ?? []).map((row) => row.user.id)]),
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
          if (!same(await platformManagementGroupSnapshot(guard.principal, eligibility, tx), guard.snapshot.group))
            throw iamAccountDenied();
          const revision = await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id=${target.id} FOR UPDATE`);
          if (!same(target, await this.candidate(target.id, tx))) throw iamAccountDenied();
          const readUsers = () =>
              tx.user.findMany({ where: { id: { in: recipientIds } }, select: userSelect, orderBy: { id: "asc" } }),
            users = await readUsers();
          if (
            users.length !== recipientIds.length ||
            users.some((row) => !recipientIds.includes(row.id)) ||
            targets?.some(
              (row) =>
                !same(
                  row.user,
                  users.find((user) => user.id === row.user.id),
                ),
            )
          )
            throw iamAccountDenied();
          await guard.recheck(tx);
          if (!persist) {
            if (!same(target, await this.candidate(target.id, tx)) || !same(users, await readUsers()))
              throw iamAccountDenied();
            await guard.recheck(tx);
            if ((await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision)
              throw iamAccountDenied();
            return undefined;
          }
          if (input.multiplier !== undefined) {
            const changed = await tx.relayChannel.updateMany({
              where: { id: target.id, status: target.status, updateTime: target.updateTime },
              data: { multiplier: input.multiplier },
            });
            if (changed.count !== 1) throw iamAccountDenied();
          }
          const now = new Date(),
            expected = targets?.map((row) => prepare(row.input, row.user.id, now));
          if (targets) {
            const ids = targets.map((row) => row.user.id);
            await tx.relayChannelProvider.updateMany({
              where: { relayChannelId: target.id, status: 1, ...(ids.length ? { userId: { notIn: ids } } : {}) },
              data: { status: 0 },
            });
            for (const [index, provider] of expected!.entries()) {
              if (provider.userId !== targets[index]!.user.id) throw iamAccountDenied();
              const normalized = values(provider),
                { userId, ...configuration } = normalized;
              await tx.relayChannelProvider.upsert({
                where: { relayChannelId_userId: { relayChannelId: target.id, userId } },
                create: { relayChannelId: target.id, ...normalized },
                update: { status: 1, ...configuration },
                select: { id: true },
              });
            }
          }
          const after = await this.candidate(target.id, tx);
          if (
            !same(
              { ...after, updateTime: target.updateTime, multiplier: target.multiplier, providers: target.providers },
              target,
            ) ||
            Number(after.multiplier) !== (input.multiplier ?? Number(target.multiplier))
          )
            throw iamAccountDenied();
          if (expected) {
            if (!same(after.providers.map(values), expected.map(values))) throw iamAccountDenied();
          } else if (!same(after.providers, target.providers)) throw iamAccountDenied();
          for (const provider of after.providers) {
            const old = target.providers.find((row) => row.id === provider.id);
            if (old && !same(old.lastSettledAt, provider.lastSettledAt)) throw iamAccountDenied();
          }
          const projection = await project(tx);
          const verify = async () => {
            await projection.verify();
            if (
              !same(after, await this.candidate(target.id, tx)) ||
              !same(users, await readUsers()) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
          };
          await verify();
          await guard.recheck(tx);
          await verify();
          return projection.value;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: configurationPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P2002"].includes(error.code))
        throw new ConflictError("Provider configuration context changed", undefined, { messageKey: "errors.conflict" });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Provider configuration failed", undefined, {
        messageKey: "errors.internalServerError",
      });
    }
  }
}
