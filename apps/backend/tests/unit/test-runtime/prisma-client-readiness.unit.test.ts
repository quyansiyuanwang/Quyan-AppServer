import { describe, expect, it } from "vitest";
import { matchesGeneratedPrismaClient, canReusePrismaClient } from "../../scripts/prisma-client-readiness.mjs";
const ready = {
  sourceSchema: "model User {}",
  generatedSchema: "model User {}",
  cliVersion: "test-version",
  clientVersion: "test-version",
  hasClient: true,
};
describe("test launcher Prisma generation", () => {
  it("reuses only an initialized client with the exact schema and CLI version", () => {
    expect(matchesGeneratedPrismaClient(ready)).toBe(true);
    expect(matchesGeneratedPrismaClient({ ...ready, generatedSchema: "// formatting only\nmodel    User { }" })).toBe(
      true,
    );
    expect(
      matchesGeneratedPrismaClient({
        ...ready,
        sourceSchema: 'model User { id String @map("a b") }',
        generatedSchema: 'model User { id String @map("ab") }',
      }),
    ).toBe(false);
    for (const change of [
      { sourceSchema: "model Changed {}" },
      { generatedSchema: "" },
      { cliVersion: "changed" },
      { clientVersion: undefined },
      { cliVersion: undefined, clientVersion: undefined },
      { hasClient: false },
      { sourceSchema: "", generatedSchema: "" },
    ])
      expect(matchesGeneratedPrismaClient({ ...ready, ...change })).toBe(false);
  });
  it("requests generation for a missing or unreadable installation", () => {
    expect(canReusePrismaClient("/missing-test-workspace")).toBe(false);
  });
});
