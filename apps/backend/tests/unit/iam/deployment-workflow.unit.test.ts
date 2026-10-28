import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
const migrationDirectory = path.resolve("migrations/20261023-iam-policy-authorization");
const read = (file: string) => readFileSync(file, "utf8");
describe("one-time IAM migration isolation", () => {
  it("leaves the standard workflow with Prisma migration and PM2 reload only", () => {
    const workflow = read(path.resolve("../../.github/workflows/deploy.yml"));
    expect(workflow).not.toMatch(/iam-migration|iam-backup-confirmed|deploy-iam|iam-migrate|migration:iam/);
    expect(workflow).toContain("prisma migrate deploy --schema ./prisma/schema.prisma");
    expect(workflow).toContain("pm2 startOrReload ./ecosystem.config.cjs --env production --update-env");
    expect(workflow.indexOf("name: Run database migrations")).toBeLessThan(workflow.indexOf("name: Reload PM2"));
    expect(existsSync(path.resolve("scripts/deploy-iam.sh"))).toBe(false);
  });
  it("only builds the administrative runner on explicit request, outside normal dist", () => {
    const build = read(path.resolve("esbuild.config.mjs"));
    const metadata = JSON.parse(read(path.resolve("package.json")));
    const bundle = read(path.join(migrationDirectory, "bundle.mjs"));
    expect(build).not.toMatch(/iam-migrate|migration.*runner|migrate-iam-deployment/);
    expect(metadata.scripts.compile).toBe("node esbuild.config.mjs");
    expect(metadata.scripts["migration:iam:bundle"]).toBe(
      "node ./migrations/20261023-iam-policy-authorization/bundle.mjs",
    );
    expect(metadata.scripts["migration:iam"]).toBe("bun ./migrations/20261023-iam-policy-authorization/run.ts");
    expect(metadata.scripts["iam:migrate"]).toBe("pnpm run migration:iam");
    expect(bundle).toContain('".tmp/migrations"');
    expect(bundle).toContain('"runner.cjs"');
    expect(bundle).toContain('external: ["@prisma/client", ".prisma/client", "sharp", "bcrypt", "jsonc-parser"]');
    expect(metadata.dependencies["jsonc-parser"]).toBeTruthy();
  });
  it("uses versioned orchestration and safe failure reporting without controlling deployment", () => {
    const entry = read(path.join(migrationDirectory, "run.ts"));
    const migration = read(path.join(migrationDirectory, "migration.ts"));
    expect(entry).toContain('from "./migration"');
    expect(entry).toContain("process.exitCode = 1");
    expect(entry).toContain("prisma?.$disconnect()");
    expect(entry).not.toMatch(/pm2|child_process|execSync|_prisma_migrations|console\.error\(error/);
    expect(entry).not.toMatch(/process\.env\.(?:IAM_AUTHORIZATION_MODE|JWT_SECRET)\s*=(?![=>])/);
    expect(migration).toContain('apply: { type: "boolean", default: false }');
    expect(migration).toContain('await sources("verify")');
    expect(existsSync(path.resolve("scripts/migrate-iam-deployment.ts"))).toBe(false);
  });
});
