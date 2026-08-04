import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const backendDirectory = path.resolve(import.meta.dirname, "../..");
const startupTimeoutMs = 20_000;
const shutdownTimeoutMs = 15_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!address || typeof address === "string") throw new Error("Failed to reserve an ephemeral TCP port");
  return address.port;
}

async function createChildTestEnv(port: number): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "appserver-shutdown-"));
  const testEnv = await readFile(path.join(backendDirectory, ".env.test"), "utf8");
  await writeFile(path.join(directory, ".env.test"), testEnv.replace(/^PORT=.*$/mu, `PORT=${port}`), "utf8");
  return directory;
}

async function waitForPing(port: number, output: () => string): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = "backend did not accept requests";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ping`);
      const body = (await response.json()) as { code?: number; message?: string };
      if (response.status === 200 && body.code === 0 && body.message === "pong") return;
      lastError = `unexpected ping response: ${response.status} ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }

  throw new Error(`Backend did not become ready: ${lastError}\n${output()}`);
}

async function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: string | null }> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Backend did not exit within ${shutdownTimeoutMs}ms`));
    }, shutdownTimeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe("backend process graceful shutdown", () => {
  let child: ChildProcess | undefined;

  afterEach(() => {
    if (child && child.exitCode === null && !child.killed) child.kill("SIGKILL");
  });

  it(
    "serves traffic and exits cleanly through the SIGTERM shutdown handler",
    async () => {
      const port = await reservePort();
      const testEnvDirectory = await createChildTestEnv(port);
      let output = "";
      try {
        const childProcess = spawn(
          "bun",
          ["-e", "await import('./src/main.ts'); setTimeout(() => process.emit('SIGTERM'), 2000)"],
          {
            cwd: backendDirectory,
            env: {
              ...process.env,
              ENV_FILE_PATH: path.join(testEnvDirectory, ".env.test"),
              NODE_ENV: "test",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        child = childProcess;
        childProcess.stdout?.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        childProcess.stderr?.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });

        await waitForPing(port, () => output);
        const result = await waitForExit(childProcess);

        expect(result).toEqual({ code: 0, signal: null });
      } finally {
        await rm(testEnvDirectory, { recursive: true, force: true });
      }
    },
    startupTimeoutMs + shutdownTimeoutMs + 5_000,
  );
});
