import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { IamDeploymentMigration, IamDeploymentMigrationError, parseIamDeploymentMigrationArgs } from "./migration";

// Load only deployment credentials here. Never print configuration or raw database exceptions.
dotenv.config({ path: process.env.ENV_FILE_PATH || ".env", quiet: true });
let prisma: PrismaClient | undefined;
async function run() {
  const options = parseIamDeploymentMigrationArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("Missing database configuration");
  if (!["legacy", "shadow", "enforce"].includes(process.env.IAM_AUTHORIZATION_MODE ?? "legacy"))
    throw new Error("Invalid authorization mode");
  prisma = new PrismaClient({ log: [], datasources: { db: { url: process.env.DATABASE_URL } } });
  const [
    { IamDeploymentMigrationRepository },
    { LegacyPolicyBackfillService },
    { LegacyAuthorizationBackfillService },
    { IamPolicyMigrationRepository },
    { IamAuthorizationMigrationRepository },
  ] = await Promise.all([
    import("../../src/store/users/iam-deployment-migration.repository"),
    import("../../src/iam/migration/legacy-policy-backfill.service"),
    import("../../src/iam/migration/legacy-authorization-backfill.service"),
    import("../../src/store/users/iam-policy-migration.repository"),
    import("../../src/store/users/iam-authorization-migration.repository"),
  ]);
  const sources = new IamDeploymentMigrationRepository(prisma, {
    requireTrustPolicies: process.env.IAM_AUTHORIZATION_MODE === "enforce",
    onDiagnostic: (diagnostic) => console.log(JSON.stringify({ event: "iam-migration-source", ...diagnostic })),
  });
  const policies = new LegacyPolicyBackfillService(new IamPolicyMigrationRepository(prisma));
  const authorizations = new LegacyAuthorizationBackfillService(new IamAuthorizationMigrationRepository(prisma));
  const migration = new IamDeploymentMigration(
    sources,
    {
      run: (options) =>
        policies.run({
          ...options,
          onEvent: (event) => console.log(JSON.stringify({ event: "iam-policy-backfill", ...event })),
        }),
    },
    {
      run: (options) =>
        authorizations.run({
          ...options,
          onEvent: (event) => console.log(JSON.stringify({ event: "iam-authorization-backfill", ...event })),
        }),
    },
  );
  const report = await migration.run(options, (event) =>
    console.log(JSON.stringify({ event: "iam-deployment-migration", ...event })),
  );
  console.log(
    JSON.stringify({
      event: "iam-deployment-migration-complete",
      ...report,
      rolesRequiringTrustPolicy: sources.rolesWithoutTrust.size,
    }),
  );
}
run()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "iam-deployment-migration-failed",
        code: error instanceof IamDeploymentMigrationError ? error.code : "operation-failed",
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma?.$disconnect();
    } catch {
      console.error(JSON.stringify({ event: "iam-deployment-migration-failed", code: "disconnect-failed" }));
      process.exitCode = 1;
    }
  });
