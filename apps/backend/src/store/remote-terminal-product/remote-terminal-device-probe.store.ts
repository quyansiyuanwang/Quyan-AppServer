import type { IamPrincipal } from "@quyan/shared";
import type { RemoteTerminalDeviceTarget } from "./remote-terminal-device-read.store";
export interface TerminalProbeGuard {
  principal: IamPrincipal;
  target: RemoteTerminalDeviceTarget;
  authorizationRevision: string;
  recheck(): Promise<void>;
}
export interface RemoteTerminalDeviceProbeStore {
  revision(principal: IamPrincipal): Promise<string>;
  record(
    guard: TerminalProbeGuard,
    pongAt: Date | null,
  ): Promise<{ deviceId: string; online: boolean; lastSeenAt: string }>;
}
