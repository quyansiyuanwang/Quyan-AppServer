import type { IamPrincipal } from "@quyan/shared";
import type { TerminalEntitlementReadView } from "./platform-terminal-entitlement-read.store";
export interface TerminalPersonalEntitlementReadStore {
  list(
    principal: IamPrincipal,
    pagination: { page: number; pageSize: number },
    status: number | undefined,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ): Promise<{ total: number; records: TerminalEntitlementReadView[] }>;
}
