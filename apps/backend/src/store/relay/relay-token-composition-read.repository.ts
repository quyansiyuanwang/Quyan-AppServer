import type { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
/** Topology proof only: no labels, credentials, routes, physical channels, or user records. */
const graphSelect = {
  id: true,
  userId: true,
  status: true,
  createTime: true,
  updateTime: true,
  routingMode: true,
  expiresAt: true,
  memberTokenConfigs: {
    select: { id: true, status: true, updateTime: true, tokenId: true, priority: true, enabled: true },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.RelayTokenSelect;
export type RelayTokenCompositionReadNode = Prisma.RelayTokenGetPayload<{ select: typeof graphSelect }>;
export class RelayTokenCompositionReadRepository {
  private static instance: RelayTokenCompositionReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenCompositionReadRepository());
  }
  async graph(userId: string, targets: readonly { id: string; userId: string; status: number; updateTime: Date }[]) {
    if (
      !isRelayTokenResourceId(userId) ||
      new Set(targets.map((row) => row.id)).size !== targets.length ||
      targets.some((row) => row.userId !== userId || !isRelayTokenResourceId(row.id) || ![0, 1].includes(row.status))
    )
      throw iamAccountDenied();
    const result: RelayTokenCompositionReadNode[] = [];
    for (let offset = 0; offset < targets.length; offset += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
      const batch = targets.slice(offset, offset + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
      const rows = await prisma.relayToken.findMany({
        where: { userId, OR: batch.map((row) => ({ id: row.id, status: row.status, updateTime: row.updateTime })) },
        select: graphSelect,
        orderBy: { id: "asc" },
      });
      if (
        rows.length !== batch.length ||
        rows.some((row) => row.userId !== userId || !batch.some((target) => target.id === row.id))
      )
        throw iamAccountDenied();
      result.push(...rows);
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }
}
