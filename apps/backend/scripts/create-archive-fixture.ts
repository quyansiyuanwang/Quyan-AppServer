import { randomUUID } from "crypto";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env" });

const args = process.argv.slice(2);
const apply = args.includes("--apply") && !args.includes("--dry-run");
const daysArg = args.find((arg) => arg.startsWith("--days="));
const countArg = args.find((arg) => arg.startsWith("--count="));
const datasetArg = args.find((arg) => arg.startsWith("--dataset="));
const dataset = datasetArg?.slice("--dataset=".length) || "api_logs";
const parsedDays = Number.parseInt(daysArg?.slice("--days=".length) || "2", 10);
const parsedCount = Number.parseInt(countArg?.slice("--count=".length) || "1", 10);

const printUsage = () => {
  console.log("Usage: pnpm run archive:fixture -- [--apply] [--days=2] [--count=1] [--dataset=api_logs]");
  console.log("Creates deliberately old API log fixtures for data-lifecycle archive testing.");
};

const validate = () => {
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to create archive fixtures in production");
  if (dataset !== "api_logs") throw new Error("Only --dataset=api_logs is supported by this fixture script");
  if (!Number.isInteger(parsedDays) || parsedDays < 2 || parsedDays > 3650)
    throw new Error("--days must be an integer between 2 and 3650");
  if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 100)
    throw new Error("--count must be an integer between 1 and 100");
};

const main = async () => {
  validate();
  const createTime = new Date(Date.now() - parsedDays * 24 * 60 * 60 * 1000 - 60 * 60 * 1000);
  console.log(`[archive-fixture] mode=${apply ? "apply" : "dry-run"}`);
  console.log(`[archive-fixture] dataset=${dataset} count=${parsedCount} createTime=${createTime.toISOString()}`);

  if (!apply) {
    console.log("[archive-fixture] no records created; re-run with --apply to insert fixtures");
    return;
  }

  const prisma = new PrismaClient();
  try {
    const records = await Promise.all(
      Array.from({ length: parsedCount }, (_, index) => {
        const fixtureId = randomUUID();
        return prisma.aPILog.create({
          data: {
            requestID: `archive-fixture-${fixtureId}`,
            path: "/__archive-fixture__/api-logs",
            method: "GET",
            ipAddress: "127.0.0.1",
            statusCode: 200,
            requestHeaders: { archiveFixture: true },
            response: { fixture: true, sequence: index + 1, note: "Safe archive lifecycle fixture" },
            createTime,
          },
          select: { id: true, requestID: true, createTime: true },
        });
      }),
    );

    console.log(`[archive-fixture] created ${records.length} api_logs fixture(s):`);
    records.forEach((record) =>
      console.log(`  - ${record.id} (${record.requestID}) @ ${record.createTime.toISOString()}`),
    );
    console.log("[archive-fixture] preview api_logs in Data Lifecycle, then run the manual archive.");
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error("[archive-fixture] failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
