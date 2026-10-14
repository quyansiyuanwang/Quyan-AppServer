import { createHash } from "node:crypto";
import type { TerminalInstallTarget } from "@/store/remote-terminal-product/terminal-install-token.store";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function terminalInstallUserFingerprint(users: readonly { id: string; updateTime: Date }[]) {
  return hash(
    [...users].sort((a, b) => a.id.localeCompare(b.id)).map((user) => [user.id, user.updateTime.toISOString()]),
  );
}
export function terminalInstallTargetFingerprint(target: TerminalInstallTarget) {
  return hash([target.id, target.userId, target.status, target.deviceLimit, target.updateTime.toISOString()]);
}
