import dotenv from "dotenv";
import Redis from "ioredis";

dotenv.config({ path: ".env" });

const DEFAULT_PATTERN = "two_factor:trusted:*";
const DEFAULT_SCAN_COUNT = 500;
const DELETE_BATCH_SIZE = 500;
const PREVIEW_LIMIT = 10;

const args = process.argv.slice(2);
const apply = args.includes("--apply") && !args.includes("--dry-run");
const pattern =
  args
    .find((arg) => arg.startsWith("--pattern="))
    ?.slice("--pattern=".length)
    .trim() || DEFAULT_PATTERN;

const scanCountArg = args.find((arg) => arg.startsWith("--scan-count="));
const parsedScanCount = Number.parseInt(scanCountArg?.slice("--scan-count=".length) || "", 10);
const scanCount = Number.isFinite(parsedScanCount) && parsedScanCount > 0 ? parsedScanCount : DEFAULT_SCAN_COUNT;

const redisHost = process.env.REDIS_HOST || "localhost";
const redisPort = Number.parseInt(process.env.REDIS_PORT || "6379", 10);
const redisPassword = process.env.REDIS_PASSWORD || undefined;
const redisDb = Number.parseInt(process.env.REDIS_DB || "0", 10);

const redis = new Redis({
  host: redisHost,
  port: Number.isFinite(redisPort) ? redisPort : 6379,
  password: redisPassword,
  db: Number.isFinite(redisDb) ? redisDb : 0,
});

const deleteInChunks = async (keys: string[]): Promise<number> => {
  if (!keys.length) return 0;

  let deleted = 0;
  for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
    const chunk = keys.slice(index, index + DELETE_BATCH_SIZE);
    if (!chunk.length) continue;

    const removed = await redis.del(...chunk);
    deleted += removed;
  }

  return deleted;
};

async function run(): Promise<void> {
  let cursor = "0";
  let matched = 0;
  let deleted = 0;
  const preview: string[] = [];

  console.log(`[trusted-device-cleanup] mode=${apply ? "apply" : "dry-run"}`);
  console.log(`[trusted-device-cleanup] redis=${redisHost}:${redisPort}/db${redisDb}`);
  console.log(`[trusted-device-cleanup] pattern=${pattern}, scanCount=${scanCount}`);

  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", String(scanCount));
      cursor = nextCursor;

      if (!keys.length) continue;

      matched += keys.length;

      if (preview.length < PREVIEW_LIMIT) {
        const needed = PREVIEW_LIMIT - preview.length;
        preview.push(...keys.slice(0, needed));
      }

      if (apply) deleted += await deleteInChunks(keys);
    } while (cursor !== "0");

    console.log(`[trusted-device-cleanup] matched=${matched}`);
    if (preview.length) {
      console.log("[trusted-device-cleanup] sample keys:");
      preview.forEach((key) => console.log(`  - ${key}`));
    }

    if (apply) console.log(`[trusted-device-cleanup] deleted=${deleted}`);
    else {
      console.log("[trusted-device-cleanup] dry-run only, no keys deleted");
      console.log("[trusted-device-cleanup] re-run with --apply to delete matched keys");
    }
  } finally {
    await redis.quit();
  }
}

run().catch((error) => {
  console.error("[trusted-device-cleanup] failed:", error);
  process.exitCode = 1;
});
