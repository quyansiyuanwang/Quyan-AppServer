import type { IamPrincipal } from "@quyan/shared";
import type { TerminalDeviceReadView } from "./platform-terminal-device-read.store";
export interface TerminalPersonalDeviceReadStore {
  list(
    principal: IamPrincipal,
    pagination: { page: number; pageSize: number },
    status: number | undefined,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ): Promise<{ total: number; records: TerminalDeviceReadView[] }>;
}
