import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "../../..");
const scriptPath = path.resolve(rootDir, "scripts/inject-build-info.mjs");
const outputDir = path.resolve(rootDir, "src/generated");
const outputFile = path.resolve(outputDir, "buildInfo.ts");
const packageJsonPath = path.resolve(rootDir, "package.json");

const importScript = async () => import(`${pathToFileURL(scriptPath).href}?t=${Date.now()}-${Math.random()}`);

describe("inject-build-info script", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("writes generated build info using git metadata", async () => {
    const execSync = vi.fn((command: string) => {
      const results: Record<string, string> = {
        "git rev-parse HEAD": "54b50123f3e8866f13613afe25b85746c9f22b7c\n",
        "git rev-parse --short HEAD": "54b5012\n",
        "git rev-parse --abbrev-ref HEAD": "main\n",
        "git log -1 --pretty=%s": "feat: switch backend runtime to bun\n",
        "git log -1 --pretty=%cI": "2026-05-09T10:00:00.000Z\n",
      };

      return results[command];
    });
    const mkdirSync = vi.fn();
    const writeFileSync = vi.fn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.doMock("child_process", () => ({ execSync }));
    vi.doMock("fs", async () => {
      const actual = await vi.importActual<typeof import("fs")>("fs");
      return {
        ...actual,
        mkdirSync,
        writeFileSync,
      };
    });

    const { version } = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    await importScript();

    expect(execSync).toHaveBeenCalledTimes(5);
    expect(mkdirSync).toHaveBeenCalledWith(outputDir, { recursive: true });
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalledWith(
      outputFile,
      expect.stringContaining(`version: ${JSON.stringify(version)}`),
      "utf8",
    );

    const generatedContent = writeFileSync.mock.calls[0]?.[1] as string;
    expect(generatedContent).toContain("export const BUILD_INFO = {");
    expect(generatedContent).toContain('commitHash: "54b50123f3e8866f13613afe25b85746c9f22b7c"');
    expect(generatedContent).toContain('commitHashShort: "54b5012"');
    expect(generatedContent).toContain('branch: "main"');
    expect(generatedContent).toContain('commitMessage: "feat: switch backend runtime to bun"');
    expect(generatedContent).toContain('commitTime: "2026-05-09T10:00:00.000Z"');
    expect(generatedContent).toContain('buildTime: "');

    expect(logSpy).toHaveBeenCalledWith("✓ Build info injected (54b5012 @ main)");
  });

  it("falls back to unknown git metadata when git commands fail", async () => {
    const execSync = vi.fn(() => {
      throw new Error("git unavailable");
    });
    const mkdirSync = vi.fn();
    const writeFileSync = vi.fn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.doMock("child_process", () => ({ execSync }));
    vi.doMock("fs", async () => {
      const actual = await vi.importActual<typeof import("fs")>("fs");
      return {
        ...actual,
        mkdirSync,
        writeFileSync,
      };
    });

    await importScript();

    expect(execSync).toHaveBeenCalledTimes(5);
    expect(mkdirSync).toHaveBeenCalledWith(outputDir, { recursive: true });
    expect(writeFileSync).toHaveBeenCalledTimes(1);

    const generatedContent = writeFileSync.mock.calls[0]?.[1] as string;
    expect(generatedContent).toContain('commitHash: "unknown"');
    expect(generatedContent).toContain('commitHashShort: "unknown"');
    expect(generatedContent).toContain('branch: "unknown"');
    expect(generatedContent).toContain('commitMessage: "unknown"');
    expect(generatedContent).toContain('commitTime: "unknown"');

    expect(logSpy).toHaveBeenCalledWith("✓ Build info injected (unknown @ unknown)");
  });
});
