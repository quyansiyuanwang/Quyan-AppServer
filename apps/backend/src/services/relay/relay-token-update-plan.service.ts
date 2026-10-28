import type { UpdateRelayTokenDto } from "@/api/dto/relay/relay.dto";
import type { RelayTokenAuthorityIdentity } from "@/store/relay/relay-token-authority";
import type { RelayTokenFullUpdateChange } from "@/store/relay/relay-token-mutation.repository";
import { RelayTokenUpdateAdmissionRepository } from "@/store/relay/relay-token-update-admission.repository";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { prepareRelayTokenUpdate } from "./relay-token-update-preparation";
import {
  RelayTokenConfigurationAdmissionService,
  type RelayTokenConfigurationInvocation,
} from "./relay-token-configuration-admission.service";
export interface RelayTokenUpdateInvocation extends RelayTokenConfigurationInvocation {
  data: UpdateRelayTokenDto;
}
/** Server-owned update capabilities; all proofs remain in the caller's rollback boundary. */
export class RelayTokenUpdatePlanService {
  private static instance: RelayTokenUpdatePlanService;
  static getInstance() {
    return (this.instance ??= new RelayTokenUpdatePlanService());
  }
  constructor(
    private readonly repository = RelayTokenUpdateAdmissionRepository.getInstance(),
    private readonly admissions = RelayTokenConfigurationAdmissionService.getInstance(),
  ) {}
  change(
    identity: RelayTokenAuthorityIdentity,
    id: string,
    invocation: RelayTokenUpdateInvocation,
    requireAllow: (action: string, resources: readonly string[]) => Promise<void>,
    decide: (action: string, resources: readonly string[]) => Promise<readonly string[]>,
  ): RelayTokenFullUpdateChange {
    let source: Awaited<ReturnType<RelayTokenUpdateAdmissionRepository["source"]>> | undefined;
    let update: Awaited<ReturnType<typeof prepareRelayTokenUpdate>>["update"] | undefined;
    let admission: ReturnType<RelayTokenConfigurationAdmissionService["plan"]> | undefined;
    return {
      kind: "update",
      prepare: async (tx, persist) => {
        if (source || update) throw iamAccountDenied();
        source = await this.repository.source(tx, identity.userId, id);
        if (!["ordered", "automatic-pool", "composite"].includes(source.routingMode)) throw iamAccountDenied();
        admission = this.admissions.plan(identity, id, source.isCustomKey, invocation, requireAllow, decide);
        update = (
          await prepareRelayTokenUpdate(source, invocation.data, {
            ...invocation.normalizers,
            ...admission.preparation(tx, persist),
          })
        ).update;
        if (!admission.retainAlias()) update.legacyToken = null;
        await admission.routing(tx, source, update);
        return update;
      },
      verify: async (tx, persisted) => {
        if (!source || !update || !admission) throw iamAccountDenied();
        await this.repository.verify(tx, source, update, persisted);
        await admission.verify(tx, persisted);
      },
    };
  }
}
