import { relayChannelChangeValidationSourceSelect } from "./relay-channel-change-request-create.repository";
import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { ApiError, ConflictError, InternalServerError } from "@/util/errors";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import type { ApplyRelayChannelModelRestrictionsRequest } from "@/api/dto/relay/relay-channel.dto";
import type {
  ChannelRestrictionPlan,
  ChannelRestrictionSource,
} from "@/services/relay/relay-channel-model-restriction";
import type { RelayModelCatalogEntry } from "@/services/relay/relay-pool-resolver.service";
const mutationPolicy = Object.freeze({ timeoutMs: 30000 });
const select = relayChannelChangeValidationSourceSelect;
type Target = Prisma.RelayChannelGetPayload<{ select: typeof select }>;
interface Guard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
export class RelayChannelModelRestrictionRepository {
  private static instance: RelayChannelModelRestrictionRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelModelRestrictionRepository());
  }
  async candidates(ids: readonly string[], tx: Prisma.TransactionClient = prisma) {
    const rows = await tx.relayChannel.findMany({
      where: { id: { in: [...ids] }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
      select,
      orderBy: { id: "asc" },
    });
    if (
      rows.length !== ids.length ||
      rows.some(
        (row) =>
          !ids.includes(row.id) ||
          !["standalone", "pooled-member", "pooled", "automatic-proxy-pool"].includes(row.channelType),
      )
    )
      throw iamAccountDenied();
    return rows;
  }
  async apply<T>(
    targets: readonly Target[],
    input: ApplyRelayChannelModelRestrictionsRequest,
    guard: Guard,
    persist: boolean,
    plan: (
      source: ChannelRestrictionSource,
      add: readonly string[],
      catalog: readonly RelayModelCatalogEntry[],
    ) => ChannelRestrictionPlan,
    project: (tx: Prisma.TransactionClient, id: string) => Promise<{ value: T; verify: () => Promise<void> }>,
  ) {
    const ids = targets.map((row) => row.id).sort();
    if (
      !ids.length ||
      new Set(ids).size !== ids.length ||
      input.targets.length !== ids.length ||
      input.targets.some((row) => !ids.includes(row.channelId))
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
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
              await platformManagementGroupSnapshot(guard.principal, Permission.RELAY_CHANNEL_UPDATE, tx),
              guard.snapshot.group,
            )
          )
            throw iamAccountDenied();
          const revision = await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM relay_channels WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
          );
          if (!same(targets, await this.candidates(ids, tx))) throw iamAccountDenied();
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
              }),
            catalog = await readCatalog(),
            updated: T[] = [],
            rejected: { id: string; reason: string }[] = [],
            projections: { verify: () => Promise<void> }[] = [],
            expected = [...targets];
          await guard.recheck(tx);
          for (const item of input.targets) {
            const index = expected.findIndex((row) => row.id === item.channelId),
              source = targets[index]!;
            const result = plan(source, item.addModels, catalog);
            if ("reason" in result) {
              rejected.push({ id: item.channelId, reason: result.reason });
              continue;
            }
            if (!persist) continue;
            const changed = await tx.relayChannel.updateMany({
              where: { id: source.id, status: source.status, updateTime: source.updateTime },
              data: result.patch,
            });
            if (changed.count !== 1) throw iamAccountDenied();
            const after = await tx.relayChannel.findUnique({ where: { id: source.id }, select });
            if (!after || !same({ ...after, updateTime: source.updateTime }, { ...source, ...result.patch }))
              throw iamAccountDenied();
            expected[index] = after;
          }
          // Project only after every write so multiple related pools observe one coherent final graph.
          if (persist)
            for (const item of input.targets) {
              if (rejected.some((row) => row.id === item.channelId)) continue;
              const response = await project(tx, item.channelId);
              projections.push(response);
              updated.push(response.value);
            }
          const verify = async () => {
            for (const response of projections) await response.verify();
            if (
              !same(expected, await this.candidates(ids, tx)) ||
              !same(catalog, await readCatalog()) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
          };
          await verify();
          await guard.recheck(tx);
          await verify();
          return { updated, rejected };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: mutationPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P2002"].includes(error.code))
        throw new ConflictError("Channel model restriction context changed", undefined, {
          messageKey: "errors.conflict",
        });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Channel model restriction failed", undefined, {
        messageKey: "errors.internalServerError",
      });
    }
  }
}
