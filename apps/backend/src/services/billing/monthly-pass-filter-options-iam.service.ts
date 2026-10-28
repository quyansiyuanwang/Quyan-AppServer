import { iamLegacyPermissionsForAction, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { fingerprintIamPolicies } from "@/iam/evaluator/policy-set-fingerprint";
import { platformTemplateArn } from "@/iam/resources/platform-template-resources";
import { platformModelPricingArn } from "@/iam/resources/platform-model-pricing-resources";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformUserGroupArn } from "@/iam/resources/platform-user-resources";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import {
  MonthlyPassFilterOptionsRepository,
  validMonthlyPassFilterTarget,
} from "@/store/billing/monthly-pass-filter-options.repository";
import {
  MONTHLY_PASS_FILTER_KINDS,
  type MonthlyPassFilterKind,
  type MonthlyPassFilterTarget,
  type MonthlyPassFilterOptionsStore,
  type MonthlyPassFilterRecord,
} from "@/store/billing/monthly-pass-filter-options.store";
import { PlatformMetadataCollectionIamService } from "../system/platform-metadata-collection-iam.service";
import { platformCollectionDecisions } from "../system/platform-collection-decisions";
import { PermissionService } from "../users/permission.service";
import { RelayChannelService } from "../relay/relay-channel.service";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { MONTHLY_PASS_MAX_PAGE_SIZE } from "@/constant/monthly-pass";
import { getLogger, LogCategory } from "@/util/logger";
import type { TypedRequest } from "@/types/express";
import type { MonthlyPassFilterOptionsDto } from "@/api/dto/billing/monthly-pass.dto";
const action = "quyan:monthly_pass:GetFilterOptions";
export function monthlyPassFilterResource(kind: MonthlyPassFilterKind, id: string) {
  switch (kind) {
    case "template":
      return platformTemplateArn("monthly-pass", id);
    case "model":
      return platformModelPricingArn(id);
    case "channel":
      return platformRelayChannelArn(id);
    case "group":
      return platformUserGroupArn(id);
    default:
      throw iamAccountDenied();
  }
}
type DynamicOptions = Pick<MonthlyPassFilterOptionsDto, "templates" | "models" | "channels" | "groups">;
export class MonthlyPassFilterOptionsIamService {
  private static instance: MonthlyPassFilterOptionsIamService;
  static getInstance() {
    return (this.instance ??= new MonthlyPassFilterOptionsIamService());
  }
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly repository: MonthlyPassFilterOptionsStore = MonthlyPassFilterOptionsRepository.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly permissions: Pick<PermissionService, "checkUserPermissions"> = PermissionService.getInstance(),
    private readonly channels: Pick<RelayChannelService, "canAccessChannelOption"> = RelayChannelService.getInstance(),
  ) {}
  async read(
    actorUserId: string,
    request: TypedRequest | undefined,
    legacy: () => Promise<MonthlyPassFilterOptionsDto>,
    staticOptions: Omit<MonthlyPassFilterOptionsDto, keyof DynamicOptions>,
  ): Promise<MonthlyPassFilterOptionsDto> {
    const mode = env.security.iamAuthorizationMode,
      required = iamLegacyPermissionsForAction(action);
    if (!["legacy", "shadow", "enforce"].includes(mode) || !required.length) throw iamAccountDenied();
    if (!request) {
      if (mode !== "legacy") throw iamAccountDenied();
      return legacy();
    }
    const principal = getIamPrincipal(request);
    if (
      !principal ||
      request.oauthAccessToken ||
      principal.subjectUserId !== actorUserId ||
      principal.principalUserId !== actorUserId
    )
      throw iamAccountDenied();
    if (mode !== "enforce") {
      const results = await Promise.all(
        required.map((permission) =>
          this.permissions.checkUserPermissions(actorUserId, [permission], {
            assumedRoleSessionId: principal.roleSessionId,
          }),
        ),
      );
      if (!results.some((result) => result.hasPermission)) throw iamAccountDenied();
    }
    if (mode === "legacy") return legacy();
    const native = () => this.native(principal, request, required, staticOptions);
    if (mode === "enforce") return native();
    try {
      await native();
    } catch {
      getLogger("MonthlyPassFilterOptionsIam", LogCategory.SECURITY).warn("Filter options shadow evaluation failed", {
        action,
        reason: "iam-evaluation-denied-or-unavailable",
      });
    }
    return legacy();
  }
  private async native(
    principal: IamPrincipal,
    request: TypedRequest,
    required: ReturnType<typeof iamLegacyPermissionsForAction>,
    staticOptions: Omit<MonthlyPassFilterOptionsDto, keyof DynamicOptions>,
  ) {
    const snapshot = await this.snapshots.snapshot(principal, required),
      policies = fingerprintIamPolicies(await this.iam.loadPolicies(principal)),
      scope = await this.repository.scope(snapshot.group.id);
    const recheck = async () => {
      await this.snapshots.recheck(principal, required, snapshot);
      if (
        fingerprintIamPolicies(await this.iam.loadPolicies(principal)) !== policies ||
        JSON.stringify(await this.repository.scope(snapshot.group.id)) !== JSON.stringify(scope)
      )
        throw iamAccountDenied();
    };
    const selected = new Map<MonthlyPassFilterKind, MonthlyPassFilterTarget[]>(),
      records: MonthlyPassFilterRecord[] = [];
    for (const kind of MONTHLY_PASS_FILTER_KINDS) {
      const targets: MonthlyPassFilterTarget[] = [];
      selected.set(kind, targets);
      const protocol = new PlatformMetadataCollectionIamService(
        this.iam,
        this.snapshots,
        {
          where: async () => scope,
          scan: (where, after, boundary) => this.repository.scan(kind, where, after, boundary),
        },
        (row) => monthlyPassFilterResource(kind, row.id),
        (row) => [row.revision],
        validMonthlyPassFilterTarget,
      );
      await protocol.read(action, principal, request, undefined, {
        visit: async (rows) => {
          const hydrated = await this.repository.hydrate(kind, scope, rows);
          if (
            hydrated.length !== rows.length ||
            new Set(hydrated.map((row) => row.id)).size !== hydrated.length ||
            hydrated.some((row) => row.kind !== kind || !rows.some((target) => target.id === row.id))
          )
            throw iamAccountDenied();
          targets.push(...rows);
          records.push(...hydrated);
        },
        finish: async () => undefined,
      });
      await recheck();
    }
    const permittedChannels = new Set<string>();
    for (const record of records)
      if (
        record.kind === "channel" &&
        (await this.channels.canAccessChannelOption(record, principal.subjectUserId, principal.roleSessionId))
      )
        permittedChannels.add(record.id);
    // Recheck every category after later categories and visibility relationships have been read.
    for (const [kind, targets] of selected)
      for (let index = 0; index < targets.length; index += IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) {
        const chunk = targets.slice(index, index + IAM_AUTHORIZATION_LIMITS.resourcesPerRequest);
        await this.repository.verify(kind, scope, chunk);
        const decisions = await platformCollectionDecisions(this.iam, {
          action,
          principal,
          request,
          resources: chunk.map((row) => monthlyPassFilterResource(kind, row.id)),
        });
        if (decisions.some((decision) => decision !== "Allow")) throw iamAccountDenied();
      }
    for (const record of records)
      if (
        record.kind === "channel" &&
        (await this.channels.canAccessChannelOption(record, principal.subjectUserId, principal.roleSessionId)) !==
          permittedChannels.has(record.id)
      )
        throw iamAccountDenied();
    await recheck();
    const result: MonthlyPassFilterOptionsDto = {
      ...staticOptions,
      templates: [],
      models: [],
      channels: [],
      groups: [],
    };
    for (const row of records)
      switch (row.kind) {
        case "template":
          result.templates.push({
            id: row.id,
            name: row.name,
            status: row.status,
            publishStatus: row.publishStatus === "published" ? "published" : "draft",
          });
          break;
        case "model":
          if (row.model) result.models.push(row.model);
          break;
        case "channel":
          if (permittedChannels.has(row.id))
            result.channels.push({ value: row.id, label: row.name ? `${row.name} (${row.id})` : row.id });
          break;
        case "group":
          result.groups.push({ id: row.id, username: row.username, name: row.name || row.username });
          break;
      }
    result.templates.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    result.templates = result.templates.slice(0, MONTHLY_PASS_MAX_PAGE_SIZE);
    result.models = [...new Set(result.models)].sort((a, b) => a.localeCompare(b));
    result.channels.sort((a, b) => a.label.localeCompare(b.label));
    result.groups.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }
}
