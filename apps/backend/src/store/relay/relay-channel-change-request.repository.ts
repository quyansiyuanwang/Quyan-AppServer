import { prisma } from "@/config/database";
import type { Prisma } from "@prisma/client";
import type { RelayChannelTransactionClient } from "./relay-channel.store";

const changeRequestInclude = {
  relayChannel: { select: { id: true, name: true } },
  submittedBy: { select: { username: true } },
} satisfies Prisma.RelayChannelChangeRequestInclude;

export class RelayChannelChangeRequestRepository {
  private static instance: RelayChannelChangeRequestRepository;

  static getInstance(): RelayChannelChangeRequestRepository {
    if (!this.instance) this.instance = new RelayChannelChangeRequestRepository();
    return this.instance;
  }

  async create(
    data: Prisma.RelayChannelChangeRequestUncheckedCreateInput,
    tx?: RelayChannelTransactionClient,
  ) {
    return (tx ?? prisma).relayChannelChangeRequest.create({ data, include: changeRequestInclude });
  }

  async findPendingByChannelId(channelId: string, tx?: RelayChannelTransactionClient) {
    return (tx ?? prisma).relayChannelChangeRequest.findFirst({
      where: { relayChannelId: channelId, reviewStatus: "pending", status: 1 },
      include: changeRequestInclude,
      orderBy: { createTime: "desc" },
    });
  }

  async findById(id: string, tx?: RelayChannelTransactionClient) {
    return (tx ?? prisma).relayChannelChangeRequest.findUnique({ where: { id }, include: changeRequestInclude });
  }

  async listMine(userId: string, page: number, pageSize: number) {
    const where = { submittedByUserId: userId, status: 1 };
    const [items, total] = await prisma.$transaction([
      prisma.relayChannelChangeRequest.findMany({
        where,
        include: changeRequestInclude,
        orderBy: { createTime: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.relayChannelChangeRequest.count({ where }),
    ]);
    return { items, total };
  }

  async listAdmin(page: number, pageSize: number, reviewStatus?: string) {
    const where = { status: 1, ...(reviewStatus ? { reviewStatus } : {}) };
    const [items, total] = await prisma.$transaction([
      prisma.relayChannelChangeRequest.findMany({
        where,
        include: changeRequestInclude,
        orderBy: { createTime: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.relayChannelChangeRequest.count({ where }),
    ]);
    return { items, total };
  }

  async updateById(
    id: string,
    data: Prisma.RelayChannelChangeRequestUncheckedUpdateInput,
    tx?: RelayChannelTransactionClient,
  ) {
    return (tx ?? prisma).relayChannelChangeRequest.update({ where: { id }, data, include: changeRequestInclude });
  }
}
