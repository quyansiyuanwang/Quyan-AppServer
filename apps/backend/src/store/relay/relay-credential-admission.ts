import type { Prisma } from "@prisma/client";
import { generateRelayTokenValue } from "@/util/relay/relay-token-credential.util";
import { plaintextCredentialValues, relayCredentialWhere } from "../plaintext-credential";

export async function relayCredentialOccupied(tx: Prisma.TransactionClient, value: string): Promise<boolean> {
  const values = plaintextCredentialValues(value, "relayToken");
  return (
    !values.length ||
    Boolean(
      await tx.relayToken.findFirst({
        where: relayCredentialWhere(values),
        select: { id: true },
      }),
    )
  );
}

export async function freshRelayCredential(tx: Prisma.TransactionClient, reserved: ReadonlySet<string> = new Set()) {
  let value: string;
  do {
    value = generateRelayTokenValue();
  } while (
    plaintextCredentialValues(value, "relayToken").some((candidate) => reserved.has(candidate)) ||
    (await relayCredentialOccupied(tx, value))
  );
  return value;
}
