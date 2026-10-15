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
  async assertTarget(expected: RelayTokenInspectionTarget) {
    const actual = await this.target(expected.userId, expected.id);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw iamAccountDenied();
  }
}
