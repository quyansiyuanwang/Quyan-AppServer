import { RelayProbeRoundRepository, scheduledProbeResources } from "@/store/relay/relay-probe-round.repository";
import { RelayProbeRunExecutionRepository } from "@/store/relay/relay-probe-run-execution.repository";
import { RelayChannelProbeAccountRepository } from "@/store/relay/relay-channel-probe-account.repository";
import { RelayProbeScheduledAuthorityService } from "./relay-probe-scheduled-authority.service";
import { probeAccountRevision } from "./relay-probe-account-editor";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { RELAY_PROBE_ROUND_POLICY } from "./relay-probe-round-policy";

export class RelayProbeScheduledExecutionIamService {
  private static instance: RelayProbeScheduledExecutionIamService;
  static getInstance() {
    return (this.instance ??= new RelayProbeScheduledExecutionIamService());
  }
  constructor(
    private readonly rounds = RelayProbeRoundRepository.getInstance(),
    private readonly authority = RelayProbeScheduledAuthorityService.getInstance(),
    private readonly runs = RelayProbeRunExecutionRepository.getInstance(),
    private readonly accounts = RelayChannelProbeAccountRepository.getInstance(),
  ) {}
  async prepare(runId: string, owner: string): Promise<(() => Promise<void>) | undefined> {
    const target = await this.rounds.execution(runId);
    if (!target) return undefined;
    const guard = await this.authority.context(target.round.actorUserId);
    await guard.authorize(scheduledProbeResources(target));
    const recheck = async () => {
      const current = await this.rounds.execution(runId);
      if (
        !current ||
        current.id !== target.id ||
        current.state !== "queued" ||
        current.round.state !== "running" ||
        !current.round.schedule.enabled ||
        current.round.schedule.status !== 1 ||
        current.round.schedule.version !== current.round.scheduleVersion ||
        current.round.actorUserId !== guard.principal.subjectUserId ||
        Date.now() - current.round.scheduledFor.getTime() > RELAY_PROBE_ROUND_POLICY.roundTimeoutMs
      )
        throw iamAccountDenied();
      await guard.recheck();
      const parent = await this.runs.inspect(runId, owner, {
        runId,
        channelId: target.channelId,
        memberChannelId: target.memberChannelId || null,
        profileId: target.profileId,
        profileUpdatedAt: target.profileUpdatedAt.toISOString(),
        targetConfigId: target.targetConfigId,
        targetConfigUpdatedAt: target.targetUpdatedAt?.toISOString() ?? null,
        accountId: target.accountId,
        principal: guard.principal,
      });
      if (!parent || !(await guard.visible(parent)) || !(await guard.visible(parent.physicalTarget)))
        throw iamAccountDenied();
      if (target.accountId) {
        const account = await this.accounts.find(target.accountId);
        if (!account || probeAccountRevision(account) !== target.accountRevision) throw iamAccountDenied();
      }
    };
    await recheck();
    return recheck;
  }
}
