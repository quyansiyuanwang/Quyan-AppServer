import { describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { env } from "@/config/env";
import { databaseDiagnosticLogs, attachDatabaseDiagnostics } from "@/config/database-diagnostics";
describe("real Prisma diagnostic boundary", () => {
  it("observes a real validation error without emitting input credentials or raw engine context", async () => {
    const levels: string[] = [],
      client = new PrismaClient({
        datasources: { db: { url: env.database.url } },
        log: databaseDiagnosticLogs(false),
      });
    attachDatabaseDiagnostics(client, (level) => levels.push(level));
    const output: string[] = [],
      errorOutput = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
        output.push(String(chunk));
        return true;
      }) as never),
      stderrOutput = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
        output.push(String(chunk));
        return true;
      }) as never);
    const marker = "fixture-only-database-diagnostic-key";
    let kind = "",
      rawErrorIncludedFixture = false;
    try {
      await client.$connect();
      try {
        await client.relayChannel.create({ data: { name: 123, openaiUpstreamApiKey: marker } as never });
      } catch (error) {
        kind = error instanceof Error ? error.name : "unknown";
        rawErrorIncludedFixture = error instanceof Error && error.message.includes(marker);
      }
    } finally {
      await client.$disconnect();
      errorOutput.mockRestore();
      stderrOutput.mockRestore();
    }
    expect(kind).toBe("PrismaClientValidationError");
    // Confirms this is the actual parameter-bearing fault, not an unconnected initialization failure.
    expect(rawErrorIncludedFixture).toBe(true);
    expect(levels).toContain("error");
    expect(output.join("")).not.toContain(marker);
    expect(output.join("")).not.toContain("openaiUpstreamApiKey");
    expect(output.join("")).not.toContain("relayChannel.create");
  });
});
