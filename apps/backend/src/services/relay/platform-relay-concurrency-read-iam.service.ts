import { iamLegacyPermissionsForAction } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { iamManagementPaginationSchema } from "@/iam/management-pagination";
import {
  platformRelayConcurrencyArn,
  platformRelayImageConcurrencyArn,
  platformRelayUserConcurrencyArn,
} from "@/iam/resources/platform-relay-concurrency-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformRelayConcurrencyReadRepository } from "@/store/relay/platform-relay-concurrency-read.repository";
import type {
  PlatformRelayConcurrencyReadStore,
  RelayConcurrencyUserTarget,
} from "@/store/relay/platform-relay-concurrency-read.store";
import { PlatformResourceReadIamService } from "@/services/system/platform-resource-read-iam.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { PermissionService } from "@/services/users/permission.service";
import { RelayProxyService } from "./relay-proxy.service";
import {
  isRelayConcurrencySubjectId,
  relayConcurrencyKeyTarget,
  projectRelayConcurrencyLimits,
  projectRelayConcurrencyTotals,
} from "@/util/relay-concurrency-status-projection";
import { getLogger, LogCategory } from "@/util/logger";
import { BadRequestError } from "@/util/errors";
import type { RelayConcurrencyStatusResponse, RelayConcurrencyStatusItemDto } from "@/api/dto/relay/relay-config.dto";
import type { TypedRequest } from "@/types/express";
const action = "quyan:relay:GetConcurrencyStatus",
  size = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
const userSignature = (row: RelayConcurrencyUserTarget) =>
  JSON.stringify([row.id, row.accountOwnerId, row.status, row.createTime, row.updateTime]);
export class PlatformRelayConcurrencyReadIamService {
  private static instance: PlatformRelayConcurrencyReadIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformRelayConcurrencyReadStore = PlatformRelayConcurrencyReadRepository.getInstance(),
    private readonly reports: Pick<RelayProxyService, "getConcurrencyStatus"> = RelayProxyService.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformRelayConcurrencyReadIamService());
  }
  async read(
    request: TypedRequest,
    selectedUserId?: string,
    pagination: { page?: number; pageSize?: number } = {},
  ): Promise<RelayConcurrencyStatusResponse> {
    const identity = getIamPrincipal(request),
      mode = env.security.iamAuthorizationMode;
    if (
      !identity ||
      request.oauthAccessToken ||
      identity.subjectUserId !== identity.principalUserId ||
      !["legacy", "shadow", "enforce"].includes(mode) ||
      (selectedUserId !== undefined && !isRelayConcurrencySubjectId(selectedUserId))
    )
      throw iamAccountDenied();
    const parsed = iamManagementPaginationSchema.safeParse(pagination);
    if (!parsed.success)
      throw new BadRequestError("Invalid concurrency status pagination", undefined, {
        messageKey: "errors.badRequest",
      });
    const principal = { ...identity },
      { page, pageSize } = parsed.data;
    const native = (prior?: RelayConcurrencyStatusResponse) =>
      new PlatformResourceReadIamService(this.iam, this.snapshots).read(
        action,
        principal,
        request,
        platformRelayConcurrencyArn(),
        async (guard) => {
          const target = await this.repository.configurationTarget(),
            configuration = await this.repository.hydrateConfiguration(target),
            limits = projectRelayConcurrencyLimits(configuration);
          const signature = JSON.stringify(target),
            expectedLimits = JSON.stringify(limits);
          guard.trackSource(async () => {
            if (
              JSON.stringify(await this.repository.configurationTarget()) !== signature ||
              JSON.stringify(projectRelayConcurrencyLimits(configuration)) !== expectedLimits
            )
              throw iamAccountDenied();
          });
          const observedUsers = new Map<string, RelayConcurrencyUserTarget>();
          const users = async (ids: readonly string[]) => {
            const found = new Map<string, RelayConcurrencyUserTarget>();
            for (let index = 0; index < ids.length; index += size) {
              const batch = ids.slice(index, index + size),
                rows = await this.repository.users(batch);
              if (
                !Array.isArray(rows) ||
                new Set(rows.map((row) => row.id)).size !== rows.length ||
                rows.some(
                  (row) =>
                    !batch.includes(row.id) ||
                    row.status !== 1 ||
                    !isRelayConcurrencySubjectId(row.id) ||
                    (row.accountOwnerId !== null && !isRelayConcurrencySubjectId(row.accountOwnerId)) ||
                    !(row.createTime instanceof Date) ||
                    !Number.isFinite(row.createTime.getTime()) ||
                    !(row.updateTime instanceof Date) ||
                    !Number.isFinite(row.updateTime.getTime()),
                )
              )
                throw iamAccountDenied();
              rows.forEach((row) => found.set(row.id, row));
            }
            return found;
          };
          const remember = (row: RelayConcurrencyUserTarget) => {
            const previous = observedUsers.get(row.id);
            if (previous && userSignature(previous) !== userSignature(row)) throw iamAccountDenied();
            observedUsers.set(row.id, {
              ...row,
              createTime: new Date(row.createTime),
              updateTime: new Date(row.updateTime),
            });
          };
          if (selectedUserId !== undefined) {
            const selected = (await users([selectedUserId])).get(selectedUserId);
            if (!selected || !(await guard.allowed([platformRelayUserConcurrencyArn(selectedUserId)])).size)
              throw iamAccountDenied();
            remember(selected);
          }
          const imageAllowed = (await guard.allowed([platformRelayImageConcurrencyArn()])).has(
            platformRelayImageConcurrencyArn(),
          );
          const items = new Map<string, RelayConcurrencyStatusItemDto>(),
            seenKeys = new Set<string>();
          const admitUsers = async (ids: readonly string[]) => {
            const rows = await users([...new Set(ids)]);
            const allowed = await guard.allowed([...rows.keys()].map((id) => platformRelayUserConcurrencyArn(id)));
            for (const row of rows.values()) if (allowed.has(platformRelayUserConcurrencyArn(row.id))) remember(row);
            return new Set([...rows.keys()].filter((id) => allowed.has(platformRelayUserConcurrencyArn(id))));
          };
          if (prior) {
            const candidates = prior.items;
            if (!Array.isArray(candidates)) throw iamAccountDenied();
            const allowed = await admitUsers(
              candidates.filter((row) => row.scope === "default").map((row) => row.userId),
            );
            for (const row of candidates) {
              if (row.scope === "image" ? !imageAllowed : !allowed.has(row.userId)) continue;
              const metadata = relayConcurrencyKeyTarget(row.key + ":slot:0");
              if (
                !metadata ||
                metadata.scope !== row.scope ||
                metadata.userId !== row.userId ||
                items.has(row.key) ||
                (selectedUserId !== undefined && row.scope === "default" && row.userId !== selectedUserId)
              )
                throw iamAccountDenied();
              items.set(row.key, { ...row });
            }
          } else {
            for (const scope of ["default", "image"] as const) {
              if (scope === "image" && !imageAllowed) continue;
              for (const kind of ["slot", "waiter"] as const) {
                let cursor = "0";
                const seenCursors = new Set<string>();
                do {
                  await guard.recheck();
                  const scanned = await this.repository.scan(scope, kind, selectedUserId, cursor);
                  if (
                    !scanned ||
                    typeof scanned.cursor !== "string" ||
                    scanned.cursor.trim() !== scanned.cursor ||
                    !/^[0-9]+$/.test(scanned.cursor) ||
                    !Array.isArray(scanned.keys) ||
                    (scanned.cursor !== "0" && seenCursors.has(scanned.cursor))
                  )
                    throw iamAccountDenied();
                  seenCursors.add(scanned.cursor);
                  cursor = scanned.cursor;
                  for (let index = 0; index < scanned.keys.length; index += size) {
                    const batch = scanned.keys.slice(index, index + size);
                    if (
                      batch.some((row) => {
                        const actual = relayConcurrencyKeyTarget(row.key);
                        return (
                          !actual ||
                          actual.baseKey !== row.baseKey ||
                          actual.scope !== row.scope ||
                          actual.userId !== row.userId ||
                          actual.kind !== row.kind ||
                          row.scope !== scope ||
                          row.kind !== kind ||
                          (selectedUserId !== undefined && scope === "default" && row.userId !== selectedUserId)
                        );
                      })
                    )
                      throw iamAccountDenied();
                    const allowed = scope === "default" ? await admitUsers(batch.map((row) => row.userId)) : undefined;
                    for (const row of batch) {
                      if (seenKeys.has(row.key) || (scope === "default" && !allowed!.has(row.userId))) continue;
                      seenKeys.add(row.key);
                      const ttl = await this.repository.ttl(row.key);
                      if (!Number.isInteger(ttl) || ttl < -2) throw iamAccountDenied();
                      if (ttl === -2) continue;
                      const item = items.get(row.baseKey) ?? {
                        key: row.baseKey,
                        userId: row.userId,
                        scope: row.scope,
                        source: "redis" as const,
                        activeCount: 0,
                        queueLength: 0,
                        ttlSeconds: null,
                      };
                      if (row.kind === "slot") {
                        item.activeCount++;
                        if (ttl >= 0) item.ttlSeconds = item.ttlSeconds === null ? ttl : Math.min(item.ttlSeconds, ttl);
                      } else item.queueLength++;
                      items.set(row.baseKey, item);
                    }
                  }
                } while (cursor !== "0");
              }
            }
          }
          guard.trackSource(async () => {
            const current = await users([...observedUsers.keys()]);
            if (
              current.size !== observedUsers.size ||
              [...observedUsers].some(
                ([id, row]) => !current.has(id) || userSignature(current.get(id)!) !== userSignature(row),
              )
            )
              throw iamAccountDenied();
          });
          const records = [...items.values()].sort(
            (a, b) => a.userId.localeCompare(b.userId) || a.scope.localeCompare(b.scope),
          );
          const start = (page - 1) * pageSize;
          return {
            redisAvailable: prior ? prior.redisAvailable : true,
            userId: selectedUserId,
            limits,
            totals: projectRelayConcurrencyTotals(records),
            items: records.slice(start, start + pageSize),
            page,
            pageSize,
            total: records.length,
            hasNext: start + pageSize < records.length,
          };
        },
      );
    if (mode === "enforce") return native();
    if (
      !(
        await this.permissions.checkUserPermissions(principal.subjectUserId, iamLegacyPermissionsForAction(action), {
          assumedRoleSessionId: principal.roleSessionId,
        })
      ).hasPermission
    )
      throw iamAccountDenied();
    const result = await this.reports.getConcurrencyStatus(selectedUserId);
    if (mode === "shadow")
      try {
        await native(result);
      } catch {
        getLogger("RelayConcurrencyIam", LogCategory.SECURITY).warn("Concurrency IAM shadow evaluation failed", {
          action,
          reason: "iam-evaluation-denied-or-unavailable",
        });
      }
    return result;
  }
}
