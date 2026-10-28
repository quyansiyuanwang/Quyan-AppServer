import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { relayChannelSubmissionArn } from "@/iam/resources/relay-channel-submission-resources";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
import { relayChannelConfigurationReadSelect } from "./relay-channel-configuration-read.repository";
import { readRelayChannelCredentialPresence } from "./relay-channel-credential-presence";
import type {
  RelayChannelConfigurationSource,
  RelayChannelCredentialPresence,
} from "@/services/relay/relay-channel-configuration-projection";
import type { RelayPoolResolverContext } from "@/services/relay/relay-pool-resolver.service";
const metadataSelect = {
  id: true,
  status: true,
  updateTime: true,
  createTime: true,
  submittedByUserId: true,
  channelType: true,
} as const;
export interface RelayChannelSubmissionReadQuery {
  page: number;
  pageSize: number;
}
export class RelayChannelSubmissionReadRepository {
  private static instance: RelayChannelSubmissionReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelSubmissionReadRepository());
  }
  async list<T>(
    principal: IamPrincipal,
    query: RelayChannelSubmissionReadQuery,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    project?: (
      records: { source: RelayChannelConfigurationSource; presence: RelayChannelCredentialPresence }[],
      context: RelayPoolResolverContext,
    ) => Promise<T[]>,
  ) {
    const { page, pageSize } = query,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize)
    )
      throw iamAccountDenied();
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      // Persisted submitter ownership is mandatory even for explicit wildcard grants or account owners.
      const where = { submittedByUserId: principal.subjectUserId, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } };
      const scan = async (authorize: boolean) => {
        const rows: Prisma.RelayChannelGetPayload<{ select: typeof metadataSelect }>[] = [],
          admitted: string[] = [];
        let after: string | undefined;
        for (;;) {
          await recheck();
          const batch = await tx.relayChannel.findMany({
            where: { ...where, ...(after ? { id: { gt: after } } : {}) },
            select: metadataSelect,
            orderBy: { id: "asc" },
            take: limit,
          });
          if (!batch.length) break;
          if (batch.some((row) => row.submittedByUserId !== principal.subjectUserId)) throw iamAccountDenied();
          if (authorize) {
            const decisions = await checkedDecide(
              batch.map((row) => relayChannelSubmissionArn(principal.accountOwnerId, principal.subjectUserId, row.id)),
            );
            batch.forEach((row, i) => {
              if (decisions[i] === "Allow") admitted.push(row.id);
            });
          }
          rows.push(...batch);
          after = batch[batch.length - 1]!.id;
          if (batch.length < limit) break;
        }
        return { rows, admitted };
      };
      const initial = await scan(true),
        allowed = new Set(initial.admitted);
      const selected = initial.rows
        .filter((row) => allowed.has(row.id))
        .sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id))
        .slice((page - 1) * pageSize, page * pageSize);
      if (!project) return { items: [] as T[], total: allowed.size, page, pageSize };
      // Provider submissions are standalone; never turn malformed historical pool data into implicit topology access.
      if (selected.some((row) => row.channelType !== "standalone")) throw iamAccountDenied();
      const ids = selected.map((row) => row.id).sort();
      const readPayload = async () => {
        if (!ids.length) return [];
        const rows = await tx.relayChannel.findMany({
          where: { ...where, id: { in: ids } },
          select: relayChannelConfigurationReadSelect,
          orderBy: { id: "asc" },
        });
        if (
          rows.length !== ids.length ||
          rows.some(
            (row) =>
              !selected.some(
                (old) =>
                  old.id === row.id &&
                  old.submittedByUserId === row.submittedByUserId &&
                  old.channelType === row.channelType &&
                  old.status === row.status &&
                  old.updateTime.getTime() === row.updateTime.getTime(),
              ),
          )
        )
          throw iamAccountDenied();
        return rows;
      };
      const readCatalog = () =>
        tx.modelPricing.findMany({
          where: { status: 1 },
          select: { id: true, status: true, updateTime: true, model: true, provider: true, supportedFormats: true },
          orderBy: { id: "asc" },
        });
      await recheck();
      const payload = await readPayload(),
        presence = await readRelayChannelCredentialPresence(tx, ids),
        catalog = ids.length ? await readCatalog() : [];
      const byId = new Map(payload.map((row) => [row.id, row]));
      const items = await project(
        selected.map((row) => {
          const source = byId.get(row.id),
            flag = presence.get(row.id);
          if (!source || !flag) throw iamAccountDenied();
          return {
            source: { ...source, pooledParentId: null, pooledParent: null, poolMembers: [], pooledChildren: [] },
            presence: flag,
          };
        }),
        {
          graph: new Map(payload.map((row) => [row.id, { ...row, poolMembers: [] }])),
          modelCatalog: catalog,
          includeDisabled: true,
        },
      );
      if (
        !isDeepStrictEqual(initial.rows, (await scan(false)).rows) ||
        !isDeepStrictEqual(payload, await readPayload()) ||
        !isDeepStrictEqual(presence, await readRelayChannelCredentialPresence(tx, ids)) ||
        (ids.length && !isDeepStrictEqual(catalog, await readCatalog()))
      )
        throw iamAccountDenied();
      return { items, total: allowed.size, page, pageSize };
    });
  }
}
