import type { IamPrincipal } from "@quyan/shared";
import type { RemoteTerminalDeviceSummary } from "@/modules/remote-terminal/protocol";

export interface RemoteTerminalDeviceTarget {
  id: string;
  deviceId: string;
  userId: string;
  controlRevision: string;
  summaryRevision: string;
}
export interface RemoteTerminalDeviceReadStore {
  scan(principal: IamPrincipal, after?: string): Promise<RemoteTerminalDeviceTarget[]>;
  targets(principal: IamPrincipal, deviceIds: readonly string[]): Promise<RemoteTerminalDeviceTarget[]>;
  hydrate(
    principal: IamPrincipal,
    expected: readonly RemoteTerminalDeviceTarget[],
  ): Promise<RemoteTerminalDeviceSummary[]>;
}
