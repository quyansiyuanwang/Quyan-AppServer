import { ForbiddenError } from "@/util/errors";
import type { RemoteTerminalDeviceTarget } from "./remote-terminal-device-read.store";
export const terminalDeviceDenied = () =>
  new ForbiddenError("IAM terminal identity or resource unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
export function assertTerminalDeviceTargets(
  actual: readonly RemoteTerminalDeviceTarget[],
  expected: readonly RemoteTerminalDeviceTarget[],
  summary = true,
) {
  const rows = new Map(actual.map((row) => [row.deviceId, row]));
  if (
    actual.length !== expected.length ||
    rows.size !== expected.length ||
    expected.some((target) => {
      const row = rows.get(target.deviceId);
      return (
        !row ||
        row.id !== target.id ||
        row.userId !== target.userId ||
        row.controlRevision !== target.controlRevision ||
        (summary && row.summaryRevision !== target.summaryRevision)
      );
    })
  )
    throw terminalDeviceDenied();
}
