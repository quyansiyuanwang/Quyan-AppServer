import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { parseIamBackfillArgs } from "../src/iam/migration/legacy-policy-backfill";
import { IamAuthorizationMigrationRepository } from "../src/store/users/iam-authorization-migration.repository";
import { LegacyAuthorizationBackfillService } from "../src/iam/migration/legacy-authorization-backfill.service";
const prisma = new PrismaClient({ log: [] });
const service = new LegacyAuthorizationBackfillService(new IamAuthorizationMigrationRepository(prisma));
const run = async () => {
  const report = await service.run({
    ...parseIamBackfillArgs(process.argv.slice(2)),
    onEvent: (event) => console.log(JSON.stringify({ event: "iam-authorization-backfill", ...event })),
  });
  console.log(JSON.stringify(report));
  if (report.invalid || report.changed) process.exitCode = 1;
};
run()
  .catch(() => {
    console.error("[iam-authorization-backfill] failed; inspect safe report and database availability");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
