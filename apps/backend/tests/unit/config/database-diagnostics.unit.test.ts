import { describe, expect, it, vi } from "vitest";
import { databaseDiagnosticLogs, attachDatabaseDiagnostics } from "@/config/database-diagnostics";
const source = () => {
  const listeners = new Map<string, () => void>();
  return {
    listeners,
    client: {
      $on: (level: string, callback: () => void) => {
        listeners.set(level, callback);
      },
    },
  };
};
describe("safe database engine diagnostics", () => {
  it("uses event-only warn/error and never enables query or stdout logging", () => {
    expect(databaseDiagnosticLogs(false)).toEqual([
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ]);
    const { client, listeners } = source(),
      report = vi.fn();
    attachDatabaseDiagnostics(client, report);
    expect([...listeners.keys()]).toEqual(["warn", "error"]);
    expect(report).not.toHaveBeenCalled();
  });
  it("never inspects or forwards raw messages, SQL parameters, targets or URLs", () => {
    const { client, listeners } = source(),
      report = vi.fn();
    attachDatabaseDiagnostics(client, report);
    const raw = Object.fromEntries(
      ["message", "target", "timestamp", "query", "params"].map((key) => [key, "fixture-diagnostic-secret"]),
    );
    for (const level of ["warn", "error"] as const) {
      const callback = listeners.get(level)!;
      Reflect.apply(callback, undefined, [raw]);
      Reflect.apply(callback, undefined, [
        new Proxy(
          {},
          {
            get: () => {
              throw new Error("raw diagnostic inspected");
            },
          },
        ),
      ]);
    }
    expect(report.mock.calls).toEqual([["warn"], ["warn"], ["error"], ["error"]]);
    expect(JSON.stringify(report.mock.calls)).not.toContain("fixture-diagnostic-secret");
  });
  it("diagnostic failures cannot replace the operation error or fall back to raw console", () => {
    const { client, listeners } = source(),
      output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      attachDatabaseDiagnostics(client, () => {
        throw new Error("fixture-secret-reporting-error");
      });
      expect(() => listeners.get("error")!()).not.toThrow();
      expect(output).not.toHaveBeenCalled();
    } finally {
      output.mockRestore();
    }
  });
  it("preserves silent test-client logging", () => {
    expect(databaseDiagnosticLogs(true)).toEqual([]);
  });
});
