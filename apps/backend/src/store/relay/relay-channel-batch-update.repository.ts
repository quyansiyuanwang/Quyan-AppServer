import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { ApiError, ConflictError, InternalServerError } from "@/util/errors";
import { batchUpdateRelayChannelPatchSchema } from "@/api/schema/relay/relay-channel.schema";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { RelayChannelModelRestrictionRepository } from "./relay-channel-model-restriction.repository";
import { readRelayChannelCredentialPresence } from "./relay-channel-credential-presence";
import type { PlatformManagementReadSnapshot } from "../system/platform-management-read.store";
import type { RelayChannelCredentialPresence } from "@/services/relay/relay-channel-configuration-projection";
import type { RelayModelCatalogEntry } from "@/services/relay/relay-pool-resolver.service";
const mutationPolicy = Object.freeze({ timeoutMs: 30000 });
export type BatchChannelSource = Awaited<ReturnType<RelayChannelModelRestrictionRepository["candidates"]>>[number];
export type BatchChannelPatch = Partial<
  Pick<Prisma.RelayChannelUpdateManyMutationInput, keyof typeof batchUpdateRelayChannelPatchSchema.shape>
>;
export type BatchChannelPreparation = (
  source: BatchChannelSource,
  catalog: readonly RelayModelCatalogEntry[],
  presence: RelayChannelCredentialPresence,
  topologyMode: "legacy" | "strict-two-tier",
  tx: Prisma.TransactionClient,
) => Promise<{ patch: BatchChannelPatch } | { reason: string }>;
interface Guard {
  principal: IamPrincipal;
  snapshot: PlatformManagementReadSnapshot;
  recheck: (tx?: Prisma.TransactionClient) => Promise<void>;
}
/** One serializable boundary for the entire batch, business rejections, audit and authorized response graph. */
export class RelayChannelBatchUpdateRepository {
  private static instance: RelayChannelBatchUpdateRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelBatchUpdateRepository());
  }
  async apply<T>(
    targets: readonly BatchChannelSource[],
    ids: readonly string[],
    guard: Guard,
    persist: boolean,
    prepare: BatchChannelPreparation,
    project: (tx: Prisma.TransactionClient, id: string) => Promise<{ value: T; verify: () => Promise<void> }>,
    audit: (result: { updated: T[]; rejected: { id: string; reason: string }[] }) => Promise<void>,
  ) {
    if (
      !ids.length ||
      new Set(ids).size !== ids.length ||
      targets.length !== ids.length ||
      targets.some((row) => !ids.includes(row.id))
    )
      throw iamAccountDenied();
    const sortedIds = [...ids].sort(),
      candidates = RelayChannelModelRestrictionRepository.getInstance();
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
            Prisma.sql`SELECT id FROM relay_channels WHERE id IN (${Prisma.join(sortedIds)}) ORDER BY id FOR UPDATE`,
          );
          if (!same(targets, await candidates.candidates(sortedIds, tx))) throw iamAccountDenied();
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
          const readTopology = () =>
            tx.relayConfig.findMany({
              where: { status: 1 },
              select: { id: true, status: true, updateTime: true, channelTopologyMode: true },
              orderBy: { id: "asc" },
            });
          const catalog = await readCatalog(),
            topology = await readTopology();
          // Do not create/repair global configuration from an authorized channel mutation.
          if (topology.length !== 1 || !["legacy", "strict-two-tier"].includes(topology[0]!.channelTopologyMode))
            throw iamAccountDenied();
          const topologyMode = topology[0]!.channelTopologyMode as "legacy" | "strict-two-tier",
            presence = await readRelayChannelCredentialPresence(tx, sortedIds),
            expected = [...targets],
            updated: T[] = [],
            rejected: { id: string; reason: string }[] = [],
            projections: { verify: () => Promise<void> }[] = [];
          await guard.recheck(tx);
          for (const id of ids) {
            const index = expected.findIndex((row) => row.id === id),
              source = targets[index]!;
            const result = await prepare(source, catalog, presence.get(id)!, topologyMode, tx);
            if ("reason" in result) {
              rejected.push({ id, reason: result.reason });
              continue;
            }
            const patch = result.patch;
            if (
              Object.keys(patch).some(
                (key) => !Object.prototype.hasOwnProperty.call(batchUpdateRelayChannelPatchSchema.shape, key),
              )
            )
              throw iamAccountDenied();
            if (!persist) continue;
            const changed = await tx.relayChannel.updateMany({
              where: { id, status: source.status, updateTime: source.updateTime },
              data: patch,
            });
            if (changed.count !== 1) throw iamAccountDenied();
            const after = (await candidates.candidates([id], tx))[0]!;
            const desired = {
              ...source,
              ...Object.fromEntries(
                Object.entries(patch)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => [
                    k,
                    v === Prisma.JsonNull || v === Prisma.DbNull
                      ? null
                      : k === "multiplier"
                        ? new Prisma.Decimal(v as number)
                        : v,
                  ]),
              ),
            };
            if (!same({ ...after, updateTime: source.updateTime }, desired)) throw iamAccountDenied();
            expected[index] = after;
          }
          if (persist)
            for (const id of ids) {
              if (rejected.some((row) => row.id === id)) continue;
              const response = await project(tx, id);
              projections.push(response);
              updated.push(response.value);
            }
          const verify = async () => {
            for (const response of projections) await response.verify();
            if (
              !same(expected, await candidates.candidates(sortedIds, tx)) ||
              !same(catalog, await readCatalog()) ||
              !same(topology, await readTopology()) ||
              !same(presence, await readRelayChannelCredentialPresence(tx, sortedIds)) ||
              (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== revision
            )
              throw iamAccountDenied();
          };
          const result = { updated, rejected };
          await verify();
          await guard.recheck(tx);
          if (persist) await audit(result);
          // Awaited audit hooks and response projection cannot outlive the authorization snapshot.
          await guard.recheck(tx);
          await verify();
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: mutationPolicy.timeoutMs },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028", "P2002"].includes(error.code))
        throw new ConflictError("Channel batch update context changed", undefined, { messageKey: "errors.conflict" });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Channel batch update failed", undefined, {
        messageKey: "errors.internalServerError",
      });
    }
  }
}
