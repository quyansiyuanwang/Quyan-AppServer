import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { EnvSpace } from "../../../src/config/env";

const backendSrc = path.resolve(__dirname, "../../../src");

function listTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

describe("environment boundary", () => {
  it("keeps process.env access inside config/env.ts", () => {
    const offenders = listTypeScriptFiles(backendSrc).filter((filePath) => {
      if (path.normalize(filePath) === path.normalize(path.join(backendSrc, "config", "env.ts"))) return false;
      return /process\.env/.test(fs.readFileSync(filePath, "utf8"));
    });

    expect(offenders).toEqual([]);
  });

  it("only exposes redacted environment diagnostics", () => {
    const diagnostics = EnvSpace.environmentDiagnostics;
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics.databaseUrl).not.toContain("123456");
    expect(serialized).not.toContain(process.env.JWT_ACCESS_SECRET || "__missing_secret__");
    expect(serialized).not.toContain(process.env.REPLAY_SIGNING_MASTER_SECRET || "__missing_replay_secret__");
  });
});
