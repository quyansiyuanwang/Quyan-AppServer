import { Permission, buildAcsResource } from "@quyan/shared";
import { RelayProbeScheduledActorRepository } from "@/store/relay/relay-probe-scheduled-actor.repository";
import { RelayProbeRoundRepository } from "@/store/relay/relay-probe-round.repository";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import { RelayProbeScheduledAuthorityService } from "./relay-probe-scheduled-authority.service";
import { RelayProbeRoundService } from "./relay-probe-round.service";
import { RelayChannelProbeService } from "./relay-channel-probe.service";
import { RELAY_PROBE_ROUND_POLICY as policy } from "./relay-probe-round-policy";
import { BadRequestError } from "@/util/errors";
import { iamAccountDenied } from "@/store/users/iam-account-principal";

/** Deployment-only initialization; no permission changes, synthetic HTTP identity or external probe requests. */
export class RelayProbePlanInitializerService {
  private static instance: RelayProbePlanInitializerService;
  static getInstance() {
    return (this.instance ??= new RelayProbePlanInitializerService());
  }
  close() {
    return RelayProbeScheduledActorRepository.getInstance().closeInitializationConnection();
  }
  async run(username: string, apply: boolean) {
    const user = await RelayProbeScheduledActorRepository.getInstance().initializationAccount(username);
    if (!user || user.status !== 1 || user.accountOwnerId) throw iamAccountDenied();
    const authority = RelayProbeScheduledAuthorityService.getInstance();
    const execute = await authority.context(user.id);
    const read = await authority.context(user.id, "quyan:relay:GetProbeRound", Permission.RELAY_CHANNEL_PROBE_READ);
    await read.authorize([buildAcsResource({ service: "quyan", region: "*", accountId: user.id, path: "account" })]);
    const preference = await NotificationPreferenceRepository.getInstance().findByUserId(user.id);
    const emailAvailable = Boolean(preference?.notificationEmail?.trim() || user.email?.trim());
    if (!emailAvailable)
      throw new BadRequestError("Probe summary email unavailable", undefined, {
        messageKey: "relayChannelProbe.scheduleEmailRequired",
      });
    const repository = RelayProbeRoundRepository.getInstance();
    const eligibleTargets = await repository.inspectTargets(execute, (profile, targetId, pooled, accountId) =>
      RelayChannelProbeService.getInstance().scheduledTargetConfigured(profile, targetId, pooled, accountId),
    );
    await read.recheck();
    const current = await repository.schedule(user.id);
    const unchanged = Boolean(
      current?.enabled && current.minuteOfDay === policy.defaultMinuteOfDay && current.timezone === policy.timezone,
    );
    const saved =
      apply && !unchanged
        ? await RelayProbeRoundService.getInstance().saveSchedule(user.id, {
            enabled: true,
            minuteOfDay: policy.defaultMinuteOfDay,
            expectedVersion: current?.version ?? 0,
          })
        : current;
    return {
      dryRun: !apply,
      changed: apply && !unchanged,
      emailAvailable,
      eligibleTargets,
      enabled: saved?.enabled ?? false,
      timezone: policy.timezone,
      minuteOfDay: saved?.minuteOfDay ?? policy.defaultMinuteOfDay,
      nextRunAt: saved?.nextRunAt ?? null,
    };
  }
}
