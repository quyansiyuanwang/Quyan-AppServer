import { Permission, buildAcsResource } from "@quyan/shared";
import { saveProbeDailyScheduleSchema } from "@/api/schema/relay/relay-probe-round.schema";
import type { TypedRequest } from "@/types/express";
import { BadRequestError } from "@/util/errors";
import { RelayProbeRoundRepository } from "@/store/relay/relay-probe-round.repository";
import { RelayProbeRoundReadRepository } from "@/store/relay/relay-probe-round-read.repository";
import { RelayProbeScheduledAuthorityService } from "./relay-probe-scheduled-authority.service";
import { RELAY_PROBE_ROUND_POLICY as policy, nextProbeDailyOccurrence } from "./relay-probe-round-policy";
import { NotificationPreferenceInitializerService } from "@/services/notification/notification-preference-initializer.service";
import { NotificationPreferenceRepository } from "@/store/notification/notification-preference.repository";
import type {
  RelayProbeDailyScheduleDto,
  SaveRelayProbeDailyScheduleRequest,
} from "@/api/dto/relay/relay-probe-round.dto";

export class RelayProbeRoundService {
  private static instance: RelayProbeRoundService;
  static getInstance() {
    return (this.instance ??= new RelayProbeRoundService());
  }
  private readonly repository = RelayProbeRoundRepository.getInstance();
  private readonly reads = RelayProbeRoundReadRepository.getInstance();
  private readonly authority = RelayProbeScheduledAuthorityService.getInstance();

  private async guard(actor: string, action: string, write: boolean, request?: TypedRequest) {
    const guard = await this.authority.context(
      actor,
      action,
      write ? Permission.RELAY_CHANNEL_PROBE_EXECUTE : Permission.RELAY_CHANNEL_PROBE_READ,
      request,
    );
    await guard.authorize([
      buildAcsResource({ service: "quyan", region: "*", accountId: guard.principal.accountOwnerId, path: "account" }),
    ]);
    return guard;
  }
  async getSchedule(actor: string, request: TypedRequest): Promise<RelayProbeDailyScheduleDto> {
    const guard = await this.guard(actor, "quyan:relay:GetProbeDailySchedule", false, request);
    const schedule = await this.repository.schedule(actor);
    await guard.recheck();
    return schedule
      ? {
          id: schedule.id,
          enabled: schedule.enabled,
          timezone: policy.timezone,
          minuteOfDay: schedule.minuteOfDay,
          version: schedule.version,
          nextRunAt: schedule.nextRunAt,
        }
      : {
          enabled: false,
          timezone: policy.timezone,
          minuteOfDay: policy.defaultMinuteOfDay,
          version: 0,
          nextRunAt: nextProbeDailyOccurrence(new Date(), policy.defaultMinuteOfDay),
        };
  }
  /** Also used by the idempotent deployment initializer after an explicit dry run. */
  async saveSchedule(
    actor: string,
    input: SaveRelayProbeDailyScheduleRequest,
    request?: TypedRequest,
  ): Promise<RelayProbeDailyScheduleDto> {
    const parsed = saveProbeDailyScheduleSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestError("Invalid daily probe schedule", undefined, { messageKey: "errors.badRequest" });
    const guard = await this.guard(actor, "quyan:relay:SaveProbeDailySchedule", true, request);
    if (input.enabled) {
      const read = await this.guard(actor, "quyan:relay:GetProbeRound", false, request);
      const recheckMutation = guard.recheck;
      guard.recheck = async () => {
        await recheckMutation();
        await read.recheck();
      };
      const preference = await NotificationPreferenceInitializerService.getInstance().getOrInitialize(actor);
      const user = await NotificationPreferenceRepository.getInstance().activeAccountEmail(actor);
      if (!(preference.notificationEmail?.trim() || user?.email?.trim()))
        throw new BadRequestError("Probe summary email unavailable", undefined, {
          messageKey: "relayChannelProbe.scheduleEmailRequired",
        });
    }
    const schedule = await this.repository.saveSchedule(actor, parsed.data, guard);
    return {
      id: schedule.id,
      enabled: schedule.enabled,
      timezone: policy.timezone,
      minuteOfDay: schedule.minuteOfDay,
      version: schedule.version,
      nextRunAt: schedule.nextRunAt,
    };
  }
  async list(actor: string, request: TypedRequest, page = 1, pageSize = 20) {
    return this.reads.list(await this.guard(actor, "quyan:relay:ListProbeRounds", false, request), page, pageSize);
  }
  async detail(actor: string, request: TypedRequest, id: string, page = 1, pageSize = 20) {
    return this.reads.detail(id, await this.guard(actor, "quyan:relay:GetProbeRound", false, request), page, pageSize);
  }
}
