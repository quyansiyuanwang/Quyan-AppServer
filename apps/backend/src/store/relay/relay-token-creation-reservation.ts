import { Prisma } from "@prisma/client";
import { relayTokenCopyNames } from "@/util/relay/relay-token-name.util";
/** Per-transaction planned additions; shadow previews reserve without inserting any rows. */
export class RelayTokenCreationReservation {
  customAdds = 0;
  readonly credentials = new Set<string>();
  private readonly names = new Set<string>();
  async name(tx: Prisma.TransactionClient, userId: string, preferred?: string | null): Promise<string | undefined> {
    const base = preferred?.trim();
    if (!base) return undefined;
    const occupied = async (name: string) =>
      this.names.has(name) ||
      (
        await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM relay_tokens WHERE userId = ${userId} AND status IN (0, 1) AND BINARY TRIM(name) = BINARY ${name} LIMIT 1`,
        )
      ).length > 0;
    if (!(await occupied(base))) {
      this.names.add(base);
      return base;
    }
    for (const candidate of relayTokenCopyNames(base)) {
      if (!(await occupied(candidate))) {
        this.names.add(candidate);
        return candidate;
      }
    }
    // The shared generator throws its localized exhausted-name error.
    return undefined;
  }
}
