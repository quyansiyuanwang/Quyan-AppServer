import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { ContentSafetySystemConfiguration } from "./content-safety-system-read.store";
/** Read and write paths share the same digest, including raw values and disabled rows. */
export async function readContentSafetySystemConfiguration(
  tx: Prisma.TransactionClient,
  lock = false,
): Promise<ContentSafetySystemConfiguration> {
  const keys: string[] = Object.values(CONFIG_KEYS.CONTENT_SAFETY);
  if (lock)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM server_configs WHERE \`key\` IN (${Prisma.join(keys)}) ORDER BY \`key\` FOR UPDATE`,
    );
  const rows = await tx.serverConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true, status: true, updateTime: true },
    orderBy: { key: "asc" },
  });
  if (
    rows.some(
      (row) =>
        row.status !== 1 ||
        !keys.includes(row.key) ||
        !(row.updateTime instanceof Date) ||
        !Number.isFinite(row.updateTime.getTime()),
    )
  )
    throw iamAccountDenied();
  return {
    values: Object.fromEntries(rows.map((row) => [row.key, row.value])),
    revision: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
}
