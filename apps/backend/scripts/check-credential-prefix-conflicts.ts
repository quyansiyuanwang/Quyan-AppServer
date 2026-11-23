import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { plaintextCredentialValues, type PlaintextCredentialType } from "../src/store/plaintext-credential";

dotenv.config({ path: ".env", quiet: true });
const prisma = new PrismaClient();
const batchSize = 1000;
type CredentialRow = { id: string; values: (string | null)[] };

async function countConflicts(type: PlaintextCredentialType, read: (after: string) => Promise<CredentialRow[]>) {
  const seen = new Set<string>();
  const conflicts = new Set<string>();
  let after = "";
  for (;;) {
    const rows = await read(after);
    for (const { values } of rows) {
      const canonical = new Set(
        values.flatMap((value) => (value ? plaintextCredentialValues(value, type).slice(0, 1) : [])),
      );
      for (const value of canonical) {
        const hash = createHash("sha256").update(value).digest("hex");
        if (seen.has(hash)) conflicts.add(hash);
        seen.add(hash);
      }
    }
    if (rows.length < batchSize) return conflicts.size;
    after = rows[rows.length - 1]!.id;
  }
}

const page = (after: string) => ({ where: { id: { gt: after } }, orderBy: { id: "asc" as const }, take: batchSize });

async function run() {
  const relay = await countConflicts("relayToken", async (after) =>
    (await prisma.relayToken.findMany({ ...page(after), select: { id: true, token: true, legacyToken: true } })).map(
      (row) => ({ id: row.id, values: [row.token, row.legacyToken] }),
    ),
  );
  const access = await countConflicts("accessKey", async (after) =>
    (await prisma.accessKey.findMany({ ...page(after), select: { id: true, key: true, legacyKey: true } })).map(
      (row) => ({ id: row.id, values: [row.key, row.legacyKey] }),
    ),
  );
  const oj = await countConflicts("ojApiKey", async (after) =>
    (await prisma.oJAPIKey.findMany({ ...page(after), select: { id: true, key: true, legacyKey: true } })).map(
      (row) => ({ id: row.id, values: [row.key, row.legacyKey] }),
    ),
  );
  console.log(`[credential-prefix-conflicts] relay=${relay} access=${access} oj=${oj}`);
  if (relay || access || oj) process.exitCode = 1;
}

run()
  .catch(() => {
    console.error("[credential-prefix-conflicts] check failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
