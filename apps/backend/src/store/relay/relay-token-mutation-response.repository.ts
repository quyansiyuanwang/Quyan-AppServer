import type { Prisma } from "@prisma/client";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamAccountDenied } from "../users/iam-account-principal";
import { relayTokenReadSelect, type RelayTokenReadRecord } from "./relay-token-read.repository";
import type { RelayTokenAuthorityIdentity } from "./relay-token-authority";
import { relayTokenArn, platformRelayTokenArn } from "@/iam/resources/relay-token-resources";
const targetSelect = { id: true, userId: true, status: true, updateTime: true } as const;
type Target = Prisma.RelayTokenGetPayload<{ select: typeof targetSelect }>;
/** Response projection consumes separate read/reveal proofs; it never falls back to rich legacy reads. */
export class RelayTokenMutationResponseRepository {
  private static instance: RelayTokenMutationResponseRepository;
  static getInstance() {
    return (this.instance ??= new RelayTokenMutationResponseRepository());
  }
  async read(
    tx: Prisma.TransactionClient,
    identity: RelayTokenAuthorityIdentity,
    id: string,
    decide: (action: string, resources: readonly string[]) => Promise<readonly string[]>,
    canReveal: boolean,
  ) {
    const { userId, managed, principal } = identity;
    const where = { userId, status: { in: [0, 1] } };
    const row = await tx.relayToken.findFirst({ where: { ...where, id }, select: relayTokenReadSelect });
    if (!row || row.id !== id || row.userId !== userId) throw iamAccountDenied();
    const targets: Target[] = [{ id: row.id, userId, status: row.status, updateTime: row.updateTime }];
    const members = row.memberTokenConfigs;
    if (members.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw iamAccountDenied();
    const outcomes = members.length
      ? await decide(
          managed ? "quyan:relay:GetManagedToken" : "quyan:relay:GetToken",
          members.map((member) =>
            managed
              ? platformRelayTokenArn(userId, member.tokenId)
              : relayTokenArn(principal.accountOwnerId, userId, member.tokenId),
          ),
        )
      : [];
    if (outcomes.length !== members.length) throw iamAccountDenied();
    const allowedIds = members.filter((_, i) => outcomes[i] === "Allow").map((member) => member.tokenId);
    const details = allowedIds.length
      ? await tx.relayToken.findMany({
          where: { ...where, id: { in: allowedIds } },
          select: { ...targetSelect, name: true, routingMode: true, expiresAt: true },
        })
      : [];
    if (details.some((detail) => detail.userId !== userId || !allowedIds.includes(detail.id))) throw iamAccountDenied();
    targets.push(...details);
    const record: RelayTokenReadRecord = {
      ...row,
      memberTokenConfigs: members
        .filter((member) => details.some((detail) => detail.id === member.tokenId))
        .map((member) => ({ ...member, memberToken: details.find((detail) => detail.id === member.tokenId)! })),
    };
    if (canReveal) {
      const resource = managed
        ? platformRelayTokenArn(userId, id)
        : relayTokenArn(principal.accountOwnerId, userId, id);
      if (
        (await decide(managed ? "quyan:relay:GetManagedToken" : "quyan:relay:GetToken", [resource]))[0] !== "Allow" ||
        (await decide(managed ? "quyan:relay:RevealManagedToken" : "quyan:relay:RevealToken", [resource]))[0] !==
          "Allow"
      )
        throw iamAccountDenied();
      const credential = await tx.relayToken.findFirst({
        where: { ...where, id, updateTime: row.updateTime },
        select: { id: true, token: true },
      });
      if (!credential || credential.id !== id) throw iamAccountDenied();
      record.token = credential.token;
    }
    return { record, targets };
  }
  async verify(tx: Prisma.TransactionClient, identity: RelayTokenAuthorityIdentity, targets: readonly Target[]) {
    const rows = await tx.relayToken.findMany({
      where: { userId: identity.userId, id: { in: targets.map((target) => target.id) }, status: { in: [0, 1] } },
      select: targetSelect,
    });
    if (
      rows.length !== targets.length ||
      rows.some(
        (row) =>
          !targets.some(
            (target) =>
              row.id === target.id &&
              row.userId === target.userId &&
              row.status === target.status &&
              row.updateTime.getTime() === target.updateTime.getTime(),
          ),
      )
    )
      throw iamAccountDenied();
  }
}
