import { createHash } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { VISIBLE_RELAY_CHANNEL_STATUSES } from "@/constant/relay-channel";
import { ApiError, ConflictError, InternalServerError } from "@/util/errors";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import {
  platformManagementGroupSnapshot,
  type PlatformManagementPermissions,
} from "../users/platform-management-principal";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { RelayUpstreamFormat } from "@quyan/shared";
import { relayUpstreamModelsPolicy } from "@/services/relay/relay-upstream-models";

const metadataSelect = {
  id: true,
  name: true,
  status: true,
  updateTime: true,
  channelType: true,
  useProxy: true,
} as const;
const catalogSelect = {
  id: true,
  status: true,
  updateTime: true,
  model: true,
  provider: true,
  supportedFormats: true,
} as const;
// Closed identifiers only: client input never becomes SQL or selects a different protocol's credential.
const protocols = {
  openai: { url: "openaiUpstreamUrl", key: "openaiUpstreamApiKey" },
  anthropic: { url: "anthropicUpstreamUrl", key: "anthropicUpstreamApiKey" },
  gemini: { url: "geminiUpstreamUrl", key: "geminiUpstreamApiKey" },
} as const;
const linkSelect = { id: true, status: true, updateTime: true, channelType: true, submittedByUserId: true } as const;
export type UpstreamModelChannelLink = Prisma.RelayChannelGetPayload<{ select: typeof linkSelect }>;
export type UpstreamModelScopeInput =
  | { kind: "platform"; permissions: PlatformManagementPermissions; link?: UpstreamModelChannelLink }
  | { kind: "submission"; link: UpstreamModelChannelLink }
  | { kind: "preview" };
export type UpstreamModelReadScope =
  | (Extract<UpstreamModelScopeInput, { kind: "platform" }> & { group: { id: string; updateTime: Date } })
  | Exclude<UpstreamModelScopeInput, { kind: "platform" }>;
export interface UpstreamModelReadGuard {
  principal: IamPrincipal;
  users: readonly { id: string; updateTime: Date }[];
  scope: UpstreamModelReadScope;
  recheck: (tx: Prisma.TransactionClient) => Promise<void>;
}
type Metadata = Prisma.RelayChannelGetPayload<{ select: typeof metadataSelect }>;
type Stamp = Metadata & { upstreamUrl: string | null; keyHash: string };
type Catalog = Prisma.ModelPricingGetPayload<{ select: typeof catalogSelect }>[];
export interface UpstreamModelSnapshot {
  targets: Stamp[];
  catalog: Catalog;
  revision: string;
}
/** Short, read-only admission boundaries. No transaction survives an upstream HTTP await. */
export class RelayChannelUpstreamModelRepository {
  private static instance: RelayChannelUpstreamModelRepository;
  static getInstance() {
    return (this.instance ??= new RelayChannelUpstreamModelRepository());
  }
  /** Identity first; expose only the server-owned link needed to choose one immutable authorization branch. */
  async link(principal: IamPrincipal, id: string, tx: Prisma.TransactionClient = prisma) {
    if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
    await assertIamAccountPrincipal(principal, tx);
    const row = await tx.relayChannel.findFirst({
      where: { id, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
      select: linkSelect,
    });
    if (
      !row ||
      row.id !== id ||
      !["standalone", "pooled-member", "pooled", "automatic-proxy-pool"].includes(row.channelType)
    )
      throw iamAccountDenied();
    return row;
  }
  private catalog(tx: Prisma.TransactionClient) {
    return tx.modelPricing.findMany({ where: { status: 1 }, select: catalogSelect, orderBy: { id: "asc" } });
  }
  private async stamps(
    tx: Prisma.TransactionClient,
    ids: readonly string[],
    format: RelayUpstreamFormat,
  ): Promise<Stamp[]> {
    const fields = protocols[format];
    const rows = await tx.$queryRaw<Stamp[]>(Prisma.sql`
      SELECT id, name, status, updateTime, channelType, useProxy,
        ${Prisma.raw(fields.url)} AS upstreamUrl, SHA2(COALESCE(${Prisma.raw(fields.key)}, ''), 256) AS keyHash
      FROM relay_channels WHERE id IN (${Prisma.join([...ids])}) ORDER BY id`);
    // MySQL raw booleans may be numbers. Match the Prisma Boolean projection exactly.
    return rows.map((row) => ({ ...row, useProxy: Boolean(row.useProxy) }));
  }
  private async boundary<T>(
    ids: readonly string[],
    guard: UpstreamModelReadGuard,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    const scope = guard.scope;
    if (
      new Set(ids).size !== ids.length ||
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      ids.some((id) => !isPlatformLogResourceId(id)) ||
      (scope.kind === "preview" ? ids.length !== 0 : ids.length === 0) ||
      (scope.kind !== "preview" && scope.link && (ids.length !== 1 || ids[0] !== scope.link.id)) ||
      (scope.kind === "submission" &&
        (scope.link.submittedByUserId !== guard.principal.subjectUserId || scope.link.channelType !== "standalone"))
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
              users: guard.users,
              recheck: () => guard.recheck(tx),
            },
            guard.principal.subjectUserId,
          );
          if (scope.kind === "platform") {
            await tx.$queryRaw(Prisma.sql`SELECT id FROM \`groups\` WHERE id=${scope.group.id} FOR UPDATE`);
            if (!same(await platformManagementGroupSnapshot(guard.principal, scope.permissions, tx), scope.group))
              throw iamAccountDenied();
          }
          if (ids.length)
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM relay_channels WHERE id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR UPDATE`,
            );
          if (
            scope.kind !== "preview" &&
            scope.link &&
            !same(await this.link(guard.principal, scope.link.id, tx), scope.link)
          )
            throw iamAccountDenied();
          return operation(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: relayUpstreamModelsPolicy.transactionTimeoutMs,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2028"].includes(error.code))
        throw new ConflictError("Upstream model authorization context changed", undefined, {
          messageKey: "errors.conflict",
        });
      if (error instanceof ApiError) throw error;
      throw new InternalServerError("Upstream model authorization unavailable", undefined, {
        messageKey: "errors.internalServerError",
      });
    }
  }
  async capture(ids: readonly string[], format: RelayUpstreamFormat, guard: UpstreamModelReadGuard) {
    if (!Object.hasOwn(protocols, format)) throw iamAccountDenied();
    return this.boundary(ids, guard, async (tx) => {
      const revision = await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId);
      await guard.recheck(tx); // Entire batch is admitted before the first credential read.
      const base = {
        where: { id: { in: [...ids] }, status: { in: VISIBLE_RELAY_CHANNEL_STATUSES } },
        orderBy: { id: "asc" as const },
      };
      const metadata = ids.length ? await tx.relayChannel.findMany({ ...base, select: metadataSelect }) : [];
      if (
        metadata.length !== ids.length ||
        metadata.some(
          (row) =>
            !ids.includes(row.id) ||
            !["standalone", "pooled-member", "pooled", "automatic-proxy-pool"].includes(row.channelType),
        )
      )
        throw iamAccountDenied();
      await guard.recheck(tx);
      const rows = !ids.length
        ? []
        : format === "openai"
          ? (
              await tx.relayChannel.findMany({
                ...base,
                select: { ...metadataSelect, openaiUpstreamUrl: true, openaiUpstreamApiKey: true },
              })
            ).map(({ openaiUpstreamUrl, openaiUpstreamApiKey, ...row }) => ({
              ...row,
              upstreamUrl: openaiUpstreamUrl,
              apiKey: openaiUpstreamApiKey,
            }))
          : format === "anthropic"
            ? (
                await tx.relayChannel.findMany({
                  ...base,
                  select: { ...metadataSelect, anthropicUpstreamUrl: true, anthropicUpstreamApiKey: true },
                })
              ).map(({ anthropicUpstreamUrl, anthropicUpstreamApiKey, ...row }) => ({
                ...row,
                upstreamUrl: anthropicUpstreamUrl,
                apiKey: anthropicUpstreamApiKey,
              }))
            : (
                await tx.relayChannel.findMany({
                  ...base,
                  select: { ...metadataSelect, geminiUpstreamUrl: true, geminiUpstreamApiKey: true },
                })
              ).map(({ geminiUpstreamUrl, geminiUpstreamApiKey, ...row }) => ({
                ...row,
                upstreamUrl: geminiUpstreamUrl,
                apiKey: geminiUpstreamApiKey,
              }));
      if (
        !same(
          rows.map(({ upstreamUrl: _url, apiKey: _key, ...row }) => row),
          metadata,
        )
      )
        throw iamAccountDenied();
      const targets: Stamp[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        updateTime: row.updateTime,
        channelType: row.channelType,
        useProxy: row.useProxy,
        upstreamUrl: row.upstreamUrl,
        keyHash: createHash("sha256")
          .update(row.apiKey ?? "")
          .digest("hex"),
      }));
      const catalog = await this.catalog(tx);
      const snapshot: UpstreamModelSnapshot = { targets, catalog, revision };
      await guard.recheck(tx);
      await this.verifyInside(tx, snapshot, format, guard);
      return {
        snapshot,
        configurations: ids.map((id) => {
          const row = rows.find((target) => target.id === id)!;
          return {
            id,
            name: row.name,
            upstreamUrl: row.upstreamUrl?.trim() || undefined,
            apiKey: row.apiKey?.trim() || undefined,
            useProxy: row.useProxy,
          };
        }),
      };
    });
  }
  private async verifyInside(
    tx: Prisma.TransactionClient,
    expected: UpstreamModelSnapshot,
    format: RelayUpstreamFormat,
    guard: UpstreamModelReadGuard,
    id?: string,
  ) {
    const targets = id ? expected.targets.filter((row) => row.id === id) : expected.targets;
    if (
      guard.scope.kind !== "preview" &&
      guard.scope.link &&
      !same(await this.link(guard.principal, guard.scope.link.id, tx), guard.scope.link)
    )
      throw iamAccountDenied();
    if (
      (!targets.length && (guard.scope.kind !== "preview" || Boolean(id))) ||
      !same(
        targets.length
          ? await this.stamps(
              tx,
              targets.map((row) => row.id),
              format,
            )
          : [],
        targets,
      ) ||
      !same(await this.catalog(tx), expected.catalog) ||
      (await readIamAuthorizationRevision(tx, guard.principal.accountOwnerId)) !== expected.revision
    )
      throw iamAccountDenied();
  }
  async verify(
    expected: UpstreamModelSnapshot,
    format: RelayUpstreamFormat,
    guard: UpstreamModelReadGuard,
    id?: string,
  ) {
    if (!Object.hasOwn(protocols, format)) throw iamAccountDenied();
    return this.boundary(id ? [id] : expected.targets.map((row) => row.id), guard, async (tx) => {
      await this.verifyInside(tx, expected, format, guard, id);
      await guard.recheck(tx);
      await this.verifyInside(tx, expected, format, guard, id);
    });
  }
}
