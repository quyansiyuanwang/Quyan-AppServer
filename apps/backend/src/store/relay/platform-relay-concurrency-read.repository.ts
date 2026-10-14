import { prisma } from "@/config/database";
import { RedisService } from "@/services/infrastructure/redis.service";
import { LockBackendUnavailableError } from "@/util/errors";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamAccountDenied } from "../users/iam-account-principal";
import { GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID } from "@/services/relay/utils/relay-concurrency.constants";
import { isRelayConcurrencySubjectId, relayConcurrencyKeyTarget } from "@/util/relay-concurrency-status-projection";
import { PlatformRelayConfigurationReadRepository } from "./platform-relay-configuration-read.repository";
import type { RelayConfigurationReadTarget } from "./platform-relay-configuration-read.store";
import type { PlatformRelayConcurrencyReadStore } from "./platform-relay-concurrency-read.store";
const unavailable = () =>
  new LockBackendUnavailableError("Confirmed concurrency telemetry unavailable", undefined, {
    messageKey: "relayProxy.concurrencyBackendUnavailable",
  });
export class PlatformRelayConcurrencyReadRepository implements PlatformRelayConcurrencyReadStore {
  private static instance: PlatformRelayConcurrencyReadRepository;
  constructor(
    private readonly redis: Pick<RedisService, "scanKeyPageWithResult" | "ttl"> = RedisService.getInstance(),
    private readonly configuration = PlatformRelayConfigurationReadRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformRelayConcurrencyReadRepository());
  }
  configurationTarget() {
    return this.configuration.configurationTarget();
  }
  hydrateConfiguration(target: RelayConfigurationReadTarget) {
    return this.configuration.hydrateConfiguration(target);
  }
  async users(ids: readonly string[]) {
    if (!ids.length) return [];
    if (
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isRelayConcurrencySubjectId(id))
    )
      throw iamAccountDenied();
    return prisma.user.findMany({
      where: { id: { in: [...ids] }, status: 1, OR: [{ accountOwnerId: null }, { accountOwner: { status: 1 } }] },
      orderBy: { id: "asc" },
      select: { id: true, accountOwnerId: true, status: true, createTime: true, updateTime: true },
    });
  }
  async scan(scope: "default" | "image", kind: "slot" | "waiter", userId?: string, cursor = "0") {
    if (
      (scope !== "default" && scope !== "image") ||
      (kind !== "slot" && kind !== "waiter") ||
      (userId !== undefined && !isRelayConcurrencySubjectId(userId)) ||
      cursor.trim() !== cursor ||
      !/^[0-9]+$/.test(cursor)
    )
      throw iamAccountDenied();
    const subject = scope === "image" ? GLOBAL_IMAGE_CONCURRENCY_RESOURCE_ID : (userId ?? "*");
    const result = await this.redis.scanKeyPageWithResult(
      `relay:concurrency:${scope}:${subject}:${kind === "slot" ? "slot" : "queue:waiter"}:*`,
      cursor,
    );
    if (!result) throw unavailable();
    const keys = result.keys.map((key) => relayConcurrencyKeyTarget(key));
    if (
      keys.some(
        (key) =>
          !key ||
          key.scope !== scope ||
          key.kind !== kind ||
          (scope === "default" && userId !== undefined && key.userId !== userId),
      )
    )
      throw iamAccountDenied();
    return { cursor: result.cursor, keys: keys as NonNullable<(typeof keys)[number]>[] };
  }
  async ttl(key: string) {
    if (!relayConcurrencyKeyTarget(key)) throw iamAccountDenied();
    const result = await this.redis.ttl(key);
    if (result === null || !Number.isInteger(result) || result < -2) throw unavailable();
    return result;
  }
}
