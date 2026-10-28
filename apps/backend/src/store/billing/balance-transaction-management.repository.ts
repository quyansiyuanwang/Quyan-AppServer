import { prisma } from "@/config/database";
import type { IamPrincipal } from "@quyan/shared";
import type { BalanceTransaction, Prisma } from "@prisma/client";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import {
  activeIamAccountUsers,
  assertIamAccountPrincipal,
  iamAccountDenied as denied,
} from "../users/iam-account-principal";
import type {
  BalanceTransactionManagementStore,
  ManagedTransactionQuery,
  ManagedTransactionTarget,
  ManagedTransactionDisplay,
} from "./balance-transaction-management.store";
export class BalanceTransactionManagementRepository implements BalanceTransactionManagementStore {
  private static instance: BalanceTransactionManagementRepository;
  static getInstance() {
    return (this.instance ??= new BalanceTransactionManagementRepository());
  }
  assertActor(principal: IamPrincipal) {
    return assertIamAccountPrincipal(principal);
  }
  private async users(principal: IamPrincipal, userId?: string) {
    await this.assertActor(principal);
    const rows = await prisma.user.findMany({
      where: { ...activeIamAccountUsers(principal.accountOwnerId), ...(userId ? { id: userId } : {}) },
      select: { id: true },
    });
    if (userId && !rows.some((row) => row.id === userId)) throw denied();
    return rows.map((row) => row.id);
  }
  async scan(principal: IamPrincipal, query: ManagedTransactionQuery, after?: ManagedTransactionTarget) {
    const ids = await this.users(principal, query.userId);
    if (!ids.length) return [];
    return prisma.balanceTransaction.findMany({
      where: {
        status: 1,
        userId: { in: ids },
        ...(query.type ? { type: query.type } : {}),
        ...(query.model ? { model: query.model } : {}),
        createTime: { gte: query.startTime, ...(query.endTime ? { lte: query.endTime } : {}) },
        ...(after
          ? { OR: [{ createTime: { lt: after.createTime } }, { createTime: after.createTime, id: { lt: after.id } }] }
          : {}),
      },
      select: { id: true, userId: true, createTime: true, updateTime: true },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  private async where(
    principal: IamPrincipal,
    targets: readonly ManagedTransactionTarget[],
  ): Promise<Prisma.BalanceTransactionWhereInput> {
    const ids = await this.users(principal);
    if (targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw denied();
    return {
      status: 1,
      userId: { in: ids },
      OR: targets.map((row) => ({ id: row.id, userId: row.userId, updateTime: row.updateTime })),
    };
  }
  async hydrate(principal: IamPrincipal, targets: readonly ManagedTransactionTarget[]) {
    if (!targets.length) return [];
    return prisma.balanceTransaction.findMany({ where: await this.where(principal, targets) });
  }
  async current(principal: IamPrincipal, targets: readonly ManagedTransactionTarget[]) {
    if (!targets.length) return [];
    return prisma.balanceTransaction.findMany({
      where: await this.where(principal, targets),
      select: { id: true, userId: true, createTime: true, updateTime: true },
    });
  }
  async display(principal: IamPrincipal, rows: readonly BalanceTransaction[]): Promise<ManagedTransactionDisplay> {
    const display: ManagedTransactionDisplay = {
      tokenNameMap: new Map(),
      usageDataMap: new Map(),
      transferDataMap: new Map(),
    };
    const ids = await this.users(principal);
    if (!rows.length) return display;
    if (rows.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest || rows.some((row) => !ids.includes(row.userId)))
      throw denied();
    const usages = await prisma.relayUsage.findMany({
      where: {
        status: 1,
        OR: rows
          .filter((row) => row.relatedId)
          .map((row) => ({ id: row.relatedId!, relayToken: { userId: row.userId } })),
      },
      select: {
        id: true,
        totalOutputTime: true,
        timeToFirstByte: true,
        isStreaming: true,
        displayChannelId: true,
        displayChannelName: true,
        relayToken: { select: { name: true, userId: true, routingMode: true } },
        logicalRequest: { select: { requestId: true } },
      },
    });
    const channels = await prisma.relayChannel.findMany({
      where: { id: { in: usages.flatMap((row) => (row.displayChannelId ? [row.displayChannelId] : [])) } },
      select: { id: true, visibilityMode: true },
    });
    const hidden = new Set(channels.filter((row) => row.visibilityMode === "hidden").map((row) => row.id));
    const passes = await prisma.monthlyPassUsage.findMany({
      where: { relayUsageId: { in: usages.map((row) => row.id) } },
      select: { relayUsageId: true, channelName: true },
    });
    for (const usage of usages) {
      if (usage.relayToken.name) display.tokenNameMap.set(usage.id, usage.relayToken.name);
      const names = new Set(
        passes.filter((row) => row.relayUsageId === usage.id && row.channelName).map((row) => row.channelName!),
      );
      display.usageDataMap.set(usage.id, {
        totalOutputTime: usage.totalOutputTime,
        timeToFirstByte: usage.timeToFirstByte,
        isStreaming: usage.isStreaming,
        requestId: usage.logicalRequest?.requestId ?? null,
        displayChannelName: usage.displayChannelName,
        automaticPoolDisplayChannelName: usage.displayChannelName,
        isAutomaticPoolUsage: usage.relayToken.routingMode === "automatic-pool",
        hideDisplayChannel: Boolean(usage.displayChannelId && hidden.has(usage.displayChannelId)),
        legacyMonthlyPassChannelName: names.size === 1 ? [...names][0] : null,
      });
    }
    const transferRows = rows.filter(
      (row) => row.relatedId && ["peer_transfer_in", "peer_transfer_out"].includes(row.type),
    );
    if (transferRows.length) {
      const transfers = await prisma.balanceTransfer.findMany({
        where: {
          status: 1,
          sender: activeIamAccountUsers(principal.accountOwnerId),
          recipient: activeIamAccountUsers(principal.accountOwnerId),
          OR: transferRows.map((row) => ({
            id: row.relatedId!,
            ...(row.type === "peer_transfer_in" ? { recipientId: row.userId } : { senderId: row.userId }),
          })),
        },
        select: {
          id: true,
          description: true,
          sender: { select: { username: true } },
          recipient: { select: { username: true } },
        },
      });
      for (const row of transfers)
        display.transferDataMap.set(row.id, {
          senderUsername: row.sender.username,
          recipientUsername: row.recipient.username,
          description: row.description,
        });
    }
    return display;
  }
}
