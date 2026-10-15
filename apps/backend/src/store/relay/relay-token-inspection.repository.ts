import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { iamAccountDenied } from "../users/iam-account-principal";
import {
  captureRelayTokenAuthority,
  RELAY_TOKEN_AUTHORITY_REQUIREMENTS,
  type RelayTokenAuthorityIdentity,
} from "./relay-token-authority";
import { RelayTokenMutationRepository } from "./relay-token-mutation.repository";
/** Usage inspection has no reason to select token credentials, routing or related members. */
const targetSelect = {
  id: true,
  userId: true,
  status: true,
  updateTime: true,
  name: true,
  quotaLimit: true,
  usedQuota: true,
  requestCount: true,
  totalTokens: true,
  lastUsedAt: true,
} as const satisfies Prisma.RelayTokenSelect;
export type RelayTokenInspectionTarget = Prisma.RelayTokenGetPayload<{ select: typeof targetSelect }>;
export class RelayTokenInspectionRepository {
  private static instance: RelayTokenInspectionRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenInspectionRepository());
  }
  tokenOwner(id: string) {
    return RelayTokenMutationRepository.getInstance().tokenOwner(id);
  }
  snapshot(identity: RelayTokenAuthorityIdentity) {
    return captureRelayTokenAuthority(identity, RELAY_TOKEN_AUTHORITY_REQUIREMENTS.read);
  }
  async target(userId: string, id: string) {
    const row = await prisma.relayToken.findFirst({
      where: { id, userId, status: { in: [0, 1] } },
      select: targetSelect,
    });
    if (!row || row.id !== id || row.userId !== userId) throw iamAccountDenied();
    return row;
  }
  async list(
    userId: string,
    ids: readonly string[] | undefined,
    decide: (ids: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ) {
    const limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    if (
      !isRelayTokenResourceId(userId) ||
      (ids &&
        (!ids.length ||
          ids.length > limit ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !isRelayTokenResourceId(id))))
    )
      throw iamAccountDenied();
    const where = { userId, status: { in: [0, 1] } };
    const select = { id: true, userId: true, status: true, updateTime: true, createTime: true } as const;
    const admitted: Prisma.RelayTokenGetPayload<{ select: typeof select }>[] = [];
    let after: string | undefined;
    for (;;) {
      await recheck();
      const rows = await prisma.relayToken.findMany({
        where: { ...where, ...(ids ? { id: { in: [...ids] } } : after ? { id: { gt: after } } : {}) },
        select,
        orderBy: { id: "asc" },
        take: limit,
      });
      if (ids && (rows.length !== ids.length || rows.some((row) => !ids.includes(row.id)))) throw iamAccountDenied();
      if (!rows.length) break;
      if (
        rows.some(
          (row, index) =>
            row.userId !== userId ||
            !isRelayTokenResourceId(row.id) ||
            (index ? rows[index - 1]!.id >= row.id : after !== undefined && after >= row.id),
        )
      )
        throw iamAccountDenied();
      const outcomes = await decide(rows.map((row) => row.id));
      if (
        outcomes.length !== rows.length ||
        outcomes.some((value) => !["Allow", "ExplicitDeny", "ImplicitDeny"].includes(value)) ||
        (ids && outcomes.some((value) => value !== "Allow"))
      )
        throw iamAccountDenied();
      admitted.push(...rows.filter((_, i) => outcomes[i] === "Allow"));
      after = rows.at(-1)!.id;
      if (ids || rows.length < limit) break;
    }
    const ordered = ids
      ? ids.map((id) => admitted.find((row) => row.id === id)!)
      : admitted.sort((a, b) => b.createTime.getTime() - a.createTime.getTime() || b.id.localeCompare(a.id));
    const targets: RelayTokenInspectionTarget[] = [];
    for (let offset = 0; offset < ordered.length; offset += limit) {
      await recheck();
      const batch = ordered.slice(offset, offset + limit);
      const rows = await prisma.relayToken.findMany({
        where: { userId, OR: batch.map((row) => ({ id: row.id, status: row.status, updateTime: row.updateTime })) },
        select: targetSelect,
      });
      if (
        rows.length !== batch.length ||
        rows.some((row) => row.userId !== userId || !batch.some((target) => row.id === target.id))
      )
        throw iamAccountDenied();
      targets.push(...batch.map((target) => rows.find((row) => row.id === target.id)!));
    }
    return targets;
  }
  async assertTargets(targets: readonly RelayTokenInspectionTarget[]) {
    for (let offset = 0; offset < targets.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      const rows = await prisma.relayToken.findMany({
        where: {
          OR: batch.map((target) => ({
            id: target.id,
            userId: target.userId,
            status: target.status,
            updateTime: target.updateTime,
          })),
        },
        select: targetSelect,
      });
      if (
        rows.length !== batch.length ||
        rows.some((row) => !batch.some((target) => JSON.stringify(row) === JSON.stringify(target)))
      )
        throw iamAccountDenied();
    }
  }
  async switchLogs(userId: string, tokenId: string, limit: number) {
    return prisma.relayChannelSwitchLog.findMany({
      where: { relayTokenId: tokenId, relayToken: { userId, status: { in: [0, 1] } } },
      orderBy: { createTime: "desc" },
      take: limit,
      select: {
        id: true,
        relayTokenId: true,
        fromDisplayChannelId: true,
        fromDisplayChannelName: true,
        toDisplayChannelId: true,
        toDisplayChannelName: true,
        triggerStatusCode: true,
        attemptNumber: true,
        requestPath: true,
        method: true,
        modelName: true,
        createTime: true,
      },
    });
  }
  async assertTarget(expected: RelayTokenInspectionTarget) {
    const actual = await this.target(expected.userId, expected.id);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw iamAccountDenied();
  }
}
