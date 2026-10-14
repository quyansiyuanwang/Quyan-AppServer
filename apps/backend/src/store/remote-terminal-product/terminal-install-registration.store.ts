import type { IamInstallTokenCapability } from "@/modules/remote-terminal/install-token";
import type { IamAccountUserMutationGuard } from "../users/iam-account-user-mutation";
import type {
  RemoteTerminalAgentRegistrationResponse,
  RemoteTerminalHostSnapshot,
} from "@/modules/remote-terminal/protocol";
export interface TerminalInstallRegistrationInput {
  fingerprint: string;
  fingerprintVersion: string;
  snapshot: RemoteTerminalHostSnapshot;
  cooldownMinutes: number;
}
export interface TerminalInstallRegistrationGuard {
  capability: IamInstallTokenCapability;
  users: IamAccountUserMutationGuard;
}
export interface TerminalInstallRegistrationStore {
  register(
    input: TerminalInstallRegistrationInput,
    guard: TerminalInstallRegistrationGuard,
  ): Promise<Omit<RemoteTerminalAgentRegistrationResponse, "heartbeatIntervalSeconds">>;
}
