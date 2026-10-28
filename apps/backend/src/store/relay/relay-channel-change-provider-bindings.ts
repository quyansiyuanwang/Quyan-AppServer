import { Prisma } from "@prisma/client";
import { z } from "zod";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { isRelayTokenResourceId } from "@/iam/resources/relay-token-resources";
import type { RelayChannelProviderConfigRequest } from "@/api/dto/relay/relay-channel.dto";
const bindingsSchema = z
  .array(z.object({ userId: z.string().refine(isRelayTokenResourceId), username: z.string().min(1).max(100) }).strict())
  .max(100);
/** New proposals pin recipient identity. Legacy proposals without bindings retain their original handling. */
export async function assertRelayChannelChangeProviderBindings(
  tx: Prisma.TransactionClient,
  snapshot: Prisma.JsonValue,
  providers: readonly RelayChannelProviderConfigRequest[] | undefined,
) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !("providerBindings" in snapshot)) return;
  const parsed = bindingsSchema.safeParse(snapshot.providerBindings);
  if (!parsed.success || !providers || parsed.data.length !== providers.length) throw iamAccountDenied();
  const bindings = parsed.data,
    ids = bindings.map((row) => row.userId).sort();
  if (
    new Set(ids).size !== ids.length ||
    new Set(bindings.map((row) => row.username)).size !== bindings.length ||
    new Set(providers.map((row) => row.username)).size !== providers.length ||
    bindings.some((row) => !providers.some((provider) => provider.username === row.username))
  )
    throw iamAccountDenied();
  if (!ids.length) return;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  const users = await tx.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, username: true, status: true },
  });
  if (
    users.length !== ids.length ||
    bindings.some(
      (row) => !users.some((user) => user.id === row.userId && user.username === row.username && user.status === 1),
    )
  )
    throw iamAccountDenied();
}
