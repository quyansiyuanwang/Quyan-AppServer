import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { validateRelayComposition, type RelayCompositionNode } from "@/util/relay/relay-composition.util";
import type { RelayTokenTransactionClient } from "./relay-token.store";

const graphSelect = {
  id: true,
  userId: true,
  routingMode: true,
  status: true,
  memberTokenConfigs: { select: { tokenId: true, priority: true, enabled: true } },
} satisfies Prisma.RelayTokenSelect;

export class RelayCompositionRepository {
  private static instance: RelayCompositionRepository;
  static getInstance(): RelayCompositionRepository {
    return (this.instance ??= new RelayCompositionRepository());
  }
  async getGraph(userId: string, tx?: RelayTokenTransactionClient): Promise<RelayCompositionNode[]> {
    return (tx ?? prisma).relayToken.findMany({ where: { userId }, select: graphSelect });
  }
  async validateWrite(tx: RelayTokenTransactionClient, node: RelayCompositionNode): Promise<void> {
    // Serialize graph writes even if a distributed lease expires during a transaction.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${node.userId} FOR UPDATE`;
    const nodes = await this.getGraph(node.userId, tx);
    validateRelayComposition([...nodes.filter((item) => item.id !== node.id), node]);
  }
  async candidates(userId: string, page: number, pageSize: number, search: string, selectedIds: string[]) {
    const where: Prisma.RelayTokenWhereInput = {
      userId,
      status: { in: [0, 1] },
      ...(search ? { OR: [{ name: { contains: search } }, { id: search }, { id: { in: selectedIds } }] } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.relayToken.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createTime: "desc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          routingMode: true,
          status: true,
          expiresAt: true,
          memberTokenConfigs: {
            select: { tokenId: true, priority: true, enabled: true },
            orderBy: { priority: "asc" },
          },
          _count: { select: { memberTokenConfigs: true } },
        },
      }),
      prisma.relayToken.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
