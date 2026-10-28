import "dotenv/config";
import { parseIamBackfillArgs } from "../src/iam/migration/legacy-policy-backfill";
import { PrismaClient } from "@prisma/client";
import { IamPolicyMigrationRepository } from "../src/store/users/iam-policy-migration.repository";
import { LegacyPolicyBackfillService } from "../src/iam/migration/legacy-policy-backfill.service";

// Suppress Prisma invocation logging: policy JSON must not appear in CLI failures.
const prisma = new PrismaClient({ log: [] });
const service = new LegacyPolicyBackfillService(new IamPolicyMigrationRepository(prisma));

const run = async () => {
  const options = parseIamBackfillArgs(process.argv.slice(2));
  const report = await service.run({
    ...options,
    onEvent: (event) => console.log(JSON.stringify({ event: "iam-policy-backfill", ...event })),
  });
  console.log(JSON.stringify(report));
  if (report.invalid || report.changed) process.exitCode = 1;
};
run()
  .catch(() => {
    console.error("[iam-policy-backfill] failed; inspect safe report and database availability");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
