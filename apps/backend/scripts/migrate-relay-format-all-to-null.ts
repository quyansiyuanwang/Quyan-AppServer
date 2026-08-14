import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env" });

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");

const run = async (): Promise<void> => {
  const [channelCount, pricingCount] = await Promise.all([
    prisma.relayChannel.count({ where: { allowedFormats: "all" } }),
    prisma.modelPricing.count({ where: { supportedFormats: "all" } }),
  ]);

  console.log(`[relay-format-all-to-null] mode=${apply ? "apply" : "dry-run"}`);
  console.log(`[relay-format-all-to-null] relayChannels=${channelCount}`);
  console.log(`[relay-format-all-to-null] modelPricing=${pricingCount}`);

  if (!apply) {
    console.log("[relay-format-all-to-null] re-run with --apply to update these records");
    return;
  }

  const [channels, pricing] = await prisma.$transaction([
    prisma.relayChannel.updateMany({ where: { allowedFormats: "all" }, data: { allowedFormats: null } }),
    prisma.modelPricing.updateMany({ where: { supportedFormats: "all" }, data: { supportedFormats: null } }),
  ]);

  console.log(`[relay-format-all-to-null] migrated relayChannels=${channels.count}`);
  console.log(`[relay-format-all-to-null] migrated modelPricing=${pricing.count}`);
};

run()
  .catch((error) => {
    console.error("[relay-format-all-to-null] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
