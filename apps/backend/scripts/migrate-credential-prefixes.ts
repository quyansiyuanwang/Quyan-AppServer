import { createHash, randomBytes } from "node:crypto";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { toCanonicalCredential } from "../../../packages/shared/src/credential.ts";

dotenv.config({ path: ".env" });

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const newSecret = (type: "projectKey" | "productKey") => {
  const prefix = type === "projectKey" ? "sk-dk-" : "sk-dpk-";
  return `${prefix}${randomBytes(32).toString("hex")}`;
};

async function run(): Promise<void> {
  const [accessKeys, relayTokens, ojKeys, projectKeys, productKeys] = await Promise.all([
    prisma.accessKey.findMany({ where: { key: { startsWith: "ak_" } }, select: { id: true, key: true } }),
    prisma.relayToken.findMany({ where: { token: { startsWith: "rlt_" } }, select: { id: true, token: true } }),
    prisma.oJAPIKey.findMany({ where: { key: { startsWith: "ojqa_" } }, select: { id: true, key: true } }),
    prisma.developerProjectApiKey.findMany({
      where: { keyPrefix: { startsWith: "dk_" } },
      select: { id: true, keyHash: true, keyPrefix: true },
    }),
    prisma.developerProductApiKey.findMany({
      where: { keyPrefix: { startsWith: "dpk_" } },
      select: { id: true, keyHash: true, keyPrefix: true },
    }),
  ]);

  console.log(`[credential-prefix-migration] mode=${apply ? "apply" : "dry-run"}`);
  console.log(
    `[credential-prefix-migration] plaintext access=${accessKeys.length} relay=${relayTokens.length} oj=${ojKeys.length}`,
  );
  console.log(`[credential-prefix-migration] hashed project=${projectKeys.length} product=${productKeys.length}`);

  if (!apply) {
    console.log("[credential-prefix-migration] re-run with --apply to migrate plaintext values and rotate hashed keys");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const row of accessKeys) {
      const canonical = toCanonicalCredential(row.key, "accessKey");
      await tx.accessKey.update({ where: { id: row.id }, data: { key: canonical, legacyKey: row.key } });
    }
    for (const row of relayTokens) {
      const canonical = toCanonicalCredential(row.token, "relayToken");
      await tx.relayToken.update({ where: { id: row.id }, data: { token: canonical, legacyToken: row.token } });
    }
    for (const row of ojKeys) {
      const canonical = toCanonicalCredential(row.key, "ojApiKey");
      await tx.oJAPIKey.update({ where: { id: row.id }, data: { key: canonical, legacyKey: row.key } });
    }
  });

  const rotated: Array<{ type: string; id: string; key: string }> = [];
  await prisma.$transaction(async (tx) => {
    for (const row of projectKeys) {
      const key = newSecret("projectKey");
      await tx.developerProjectApiKey.update({
        where: { id: row.id },
        data: { keyHash: hash(key), legacyKeyHash: row.keyHash, keyPrefix: key.slice(0, 12) },
      });
      rotated.push({ type: "project", id: row.id, key });
    }
    for (const row of productKeys) {
      const key = newSecret("productKey");
      await tx.developerProductApiKey.update({
        where: { id: row.id },
        data: { keyHash: hash(key), legacyKeyHash: row.keyHash, keyPrefix: key.slice(0, 12) },
      });
      rotated.push({ type: "product", id: row.id, key });
    }
  });

  console.log(
    `[credential-prefix-migration] migrated plaintext=${accessKeys.length + relayTokens.length + ojKeys.length}`,
  );
  console.log(`[credential-prefix-migration] rotated hashed=${rotated.length}`);
  if (rotated.length) {
    console.log("[credential-prefix-migration] one-time key delivery (store securely; values are not recoverable):");
    for (const item of rotated) console.log(JSON.stringify(item));
  }
}

run()
  .catch((error) => {
    console.error("[credential-prefix-migration] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
