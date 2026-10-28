import type { Prisma } from "@prisma/client";
export type DatabaseDiagnosticLevel = "warn" | "error";
export type DatabaseDiagnosticReporter = (level: DatabaseDiagnosticLevel) => void;
interface DatabaseDiagnosticSource {
  $on: (level: DatabaseDiagnosticLevel, callback: () => void) => void;
}
/** Use event-only engine diagnostics; never opt into raw stdout or query logging. */
export function databaseDiagnosticLogs(isTest: boolean) {
  return isTest
    ? []
    : ([
        { emit: "event" as const, level: "warn" as const },
        { emit: "event" as const, level: "error" as const },
      ] satisfies Prisma.LogDefinition[]);
}
/** Never inspect raw messages, SQL, parameters, targets or connection URLs from engine events. */
export function attachDatabaseDiagnostics(client: DatabaseDiagnosticSource, report: DatabaseDiagnosticReporter) {
  const emit = (level: DatabaseDiagnosticLevel) => {
    try {
      report(level);
    } catch {
      /* Diagnostics must not replace the original operation error. */
    }
  };
  client.$on("warn", () => emit("warn"));
  client.$on("error", () => emit("error"));
}
