import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformRelayProbeAccountArn } from "@/iam/resources/platform-relay-probe-resources";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
export const relayProbeAccountPublicSelect = {
  id: true,
  name: true,
  tokenPath: true,
  expiresPath: true,
  expiresMode: true,
  fallbackTtlSeconds: true,
  minLoginIntervalSeconds: true,
  lastLoginAttemptAt: true,
  updateTime: true,
} as const satisfies Prisma.RelayChannelProbeAccountSelect;
export type RelayProbeAccountPublicRecord = Prisma.RelayChannelProbeAccountGetPayload<{
  select: typeof relayProbeAccountPublicSelect;
}> & { hasCredentials: boolean };
export interface PlatformRelayProbeAccountReadStore {
  list<T>(
    principal: IamPrincipal,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    map: (account: RelayProbeAccountPublicRecord) => Promise<T>,
  ): Promise<T[]>;
}
export class PlatformRelayProbeAccountReadRepository implements PlatformRelayProbeAccountReadStore {
  private static instance: PlatformRelayProbeAccountReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformRelayProbeAccountReadRepository());
  }
  async list<T>(
    principal: IamPrincipal,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    map: (account: RelayProbeAccountPublicRecord) => Promise<T>,
  ) {
    const limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      const admitted: { id: string; updateTime: Date }[] = [];
      let after: string | undefined;
      for (;;) {
        const rows = await tx.relayChannelProbeAccount.findMany({
          where: after ? { id: { gt: after } } : {},
          select: { id: true, updateTime: true },
          orderBy: { id: "asc" },
          take: limit,
        });
        if (!rows.length) break;
        const outcomes = await checkedDecide(rows.map((row) => platformRelayProbeAccountArn(row.id)));
        rows.forEach((row, index) => {
          if (outcomes[index] === "Allow") admitted.push(row);
        });
        after = rows[rows.length - 1]!.id;
        if (rows.length < limit) break;
      }
      if (!admitted.length) return [];
      const revisions = new Map(admitted.map((row) => [row.id, row.updateTime])),
        rows = await tx.relayChannelProbeAccount.findMany({
          where: { id: { in: [...revisions.keys()] } },
          orderBy: { name: "asc" },
          select: relayProbeAccountPublicSelect,
        });
      if (
        rows.length !== admitted.length ||
        rows.some((row) => revisions.get(row.id)?.getTime() !== row.updateTime.getTime())
      )
        throw iamAccountDenied();
      const result: T[] = [];
      for (const row of rows) {
        // Presence is computed in storage. Ciphertext, IV, auth tag and login workflow are never selected.
        const count = await tx.relayChannelProbeAccount.count({
          where: { id: row.id, encryptedCredentials: { not: "" } },
        });
        if (![0, 1].includes(count)) throw iamAccountDenied();
        result.push(await map({ ...row, hasCredentials: count === 1 }));
      }
      return result;
    });
  }
}
