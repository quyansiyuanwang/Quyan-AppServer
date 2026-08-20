import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

export interface WorkspaceRuntimeProvider {
  create(workspaceId: string, limits: Record<string, unknown>): Promise<{ handle: string }>;
  stop(handle: string): Promise<void>;
  destroy(handle: string): Promise<void>;
  execute(handle: string, command: string, args: string[], timeoutMs: number): Promise<string>;
}

/** Remote runtime hook. The AppServer never executes user commands locally. */
export class RootlessDockerWorkspaceProvider implements WorkspaceRuntimeProvider {
  async create(workspaceId: string, limits: Record<string, unknown>) {
    const name = `appserver-agent-${workspaceId}-${randomUUID().slice(0, 8)}`;
    const memory = `${Math.max(128, Number(limits.memoryMb || 512))}m`;
    const cpus = String(Math.max(1, Number(limits.cpu || 1)));
    const { stdout } = await execFileAsync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        name,
        "--user",
        "0:0",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt",
        "no-new-privileges",
        "--network",
        "none",
        "--pids-limit",
        "128",
        "--memory",
        memory,
        "--cpus",
        cpus,
        "python:3.12-slim",
        "sleep",
        "infinity",
      ],
      { timeout: 30_000 },
    );
    return { handle: stdout.trim() || name };
  }

  async stop(handle: string) {
    await execFileAsync("docker", ["stop", "--time", "5", handle], { timeout: 15_000 });
  }
  async destroy(handle: string) {
    await execFileAsync("docker", ["rm", "--force", handle], { timeout: 15_000 });
  }
  async execute(handle: string, command: string, args: string[], timeoutMs: number) {
    if (!/^[a-zA-Z0-9._/-]+$/.test(command) || args.some((arg) => /[\r\n\0]/.test(arg)))
      throw new Error("Unsafe workspace command");
    const result = await execFileAsync("docker", ["exec", handle, command, ...args], {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout;
  }
}
