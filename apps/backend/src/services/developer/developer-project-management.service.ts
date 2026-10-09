import { performance } from "node:perf_hooks";
import { buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { evaluatePolicies } from "@/iam/evaluator/policy-evaluator";
import { iamManagementPaginationSchema } from "@/iam/management-pagination";
import { developerProjectArn, developerKvArn, developerSecretArn } from "@/iam/request/developer-resource-resolvers";
import {
  developerItemArn,
  developerProjectApiKeyArn,
  developerShortLinkArn,
  developerStatusMonitorArn,
  developerPushChannelArn,
  type DeveloperItemResourceType,
} from "@/iam/resources/developer-resources";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { principalConditionContext, requestConditionContext } from "@/iam/request/condition-context";
import { getRequestContext } from "@/util/request-context";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";
import { getLogger, LogCategory } from "@/util/logger";
import { UserRepository } from "@/store/users/user.repository";
import { DeveloperProjectRepository } from "@/store/developer/developer-project.repository";
import {
  DeveloperPushChannelRepository,
  type ResolvedPushSecretBinding,
} from "@/store/developer/developer-push-channel.repository";
import {
  requiresPushSecretAuthority,
  pushChannelSecretReferenceDto,
  readStoredPushSecretReference,
} from "@/store/developer/developer-push-channel.mapping";
import type {
  CreateDeveloperProjectDto,
  DeveloperProjectDto,
  DeveloperProjectPageDto,
  UpdateDeveloperStatusPageDto,
  DeveloperKvValueDto,
  DeveloperKvPageDto,
  DeveloperSecretDto,
  DeveloperSecretPageDto,
  SetKvValueDto,
  UpsertDeveloperSecretDto,
  CreateShortLinkDto,
  UpdateShortLinkDto,
  DeveloperShortLinkDto,
  DeveloperShortLinkPageDto,
  DeveloperShortLinkStatsDto,
  DeveloperApiKeyDto,
  DeveloperApiKeyPageDto,
  DeveloperStatusMonitorDto,
  DeveloperStatusMonitorPageDto,
  CreateDeveloperStatusMonitorDto,
  UpdateDeveloperStatusMonitorDto,
  CreateDeveloperPushChannelDto,
  UpdateDeveloperPushChannelDto,
  DeveloperPushSecretReferenceDto,
  DeveloperPushChannelDto,
  DeveloperPushChannelPageDto,
} from "@/api/dto/developer/developer.dto";

/** JWT management has its own IAM boundary; project-key/public/scheduler calls retain their separate guards. */
export class DeveloperProjectManagementService {
  private static instance: DeveloperProjectManagementService;
  private constructor(
    private readonly projects = DeveloperProjectRepository.getInstance(),
    private readonly users = UserRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly channels = DeveloperPushChannelRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new DeveloperProjectManagementService());
  }

  private async actorContext(actorUserId: string) {
    const actor = await this.users.findById(actorUserId);
    const request = getRequestContext();
    const accountOwnerId = actor?.accountOwnerId || actor?.id;
    const principal: IamPrincipal | undefined = request
      ? getIamPrincipal(request)
      : actor && accountOwnerId
        ? {
            subjectUserId: actor.id,
            principalUserId: actor.id,
            accountOwnerId,
            subjectType: actor.userType === "root" && actor.id === accountOwnerId ? "root" : "sub_user",
          }
        : undefined;
    if (
      !actor ||
      actor.status !== 1 ||
      !principal ||
      principal.subjectUserId !== actor.id ||
      principal.principalUserId !== actor.id ||
      principal.accountOwnerId !== accountOwnerId
    )
      throw new ForbiddenError("Invalid project management identity", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    return {
      principal,
      request,
      context: request ? requestConditionContext(request, principal) : principalConditionContext(principal),
    };
  }
  private resource(accountOwnerId: string, projectId: string) {
    return developerProjectArn(accountOwnerId, projectId);
  }
  private recordDecision(
    identity: Awaited<ReturnType<DeveloperProjectManagementService["actorContext"]>>,
    action: string,
    resource: string,
    result: ReturnType<typeof evaluatePolicies>,
    start: number,
    legacyAllowed: boolean,
  ) {
    if (identity.request) (identity.request.iamDecisions ??= []).push({ ...result, action, resource });
    auditIamDecision({
      requestId: identity.request?.res?.locals.requestId,
      principal: identity.principal,
      action,
      resource,
      result,
      evaluationLatencyMs: performance.now() - start,
      authorizationMode: env.security.iamAuthorizationMode,
      ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed } : {}),
    });
  }

  async listProjects(actorUserId: string): Promise<DeveloperProjectDto[]> {
    if (env.security.iamAuthorizationMode === "enforce") return (await this.listProjectsPage(actorUserId)).items;
    const items = await this.projects.listProjects(actorUserId);
    if (env.security.iamAuthorizationMode === "shadow") {
      try {
        const identity = await this.actorContext(actorUserId);
        await this.filterProjectRows(
          identity,
          items.map((item) => ({ item, userId: actorUserId })),
          actorUserId,
        );
      } catch {
        getLogger("DeveloperProjectIam", LogCategory.SECURITY).warn("Project list shadow evaluation failed", {
          reason: "iam-evaluation-unavailable",
          principalUserId: actorUserId,
        });
      }
    }
    return items;
  }
  private async filterProjectRows(
    identity: Awaited<ReturnType<DeveloperProjectManagementService["actorContext"]>>,
    candidates: readonly { item: DeveloperProjectDto; userId: string }[],
    actorUserId: string,
  ): Promise<DeveloperProjectDto[]> {
    const start = performance.now(),
      policies = await this.iam.loadPolicies(identity.principal);
    const allowed: DeveloperProjectDto[] = [];
    for (const candidate of candidates) {
      const resource = this.resource(identity.principal.accountOwnerId, candidate.item.id);
      const result = evaluatePolicies(policies, {
        action: "quyan:developer:ListProjects",
        resource,
        context: identity.context,
      });
      this.recordDecision(
        identity,
        "quyan:developer:ListProjects",
        resource,
        result,
        start,
        candidate.userId === actorUserId,
      );
      if (result.decision === "Allow") allowed.push(candidate.item);
    }
    return allowed;
  }
  async listProjectsPage(
    actorUserId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<DeveloperProjectPageDto> {
    const pagination = iamManagementPaginationSchema.safeParse(options);
    if (!pagination.success)
      throw new BadRequestError("Invalid project pagination", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const { page, pageSize } = pagination.data;
    const identity = await this.actorContext(actorUserId),
      mode = env.security.iamAuthorizationMode;
    const candidates = await this.projects.listProjectCandidates({
      ...(mode === "enforce" ? { accountOwnerId: identity.principal.accountOwnerId } : { userId: actorUserId }),
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
    });
    const visible = candidates.slice(0, pageSize);
    let items = visible.map((candidate) => candidate.item);
    if (mode !== "legacy") {
      try {
        const allowed = await this.filterProjectRows(identity, visible, actorUserId);
        if (mode === "enforce") items = allowed;
      } catch (error) {
        if (mode !== "shadow") throw error;
        getLogger("DeveloperProjectIam", LogCategory.SECURITY).warn("Project list shadow evaluation failed", {
          reason: "iam-evaluation-unavailable",
          principalUserId: actorUserId,
        });
      }
    }
    return { items, page, pageSize, hasNext: candidates.length > pageSize };
  }

  private async projectOwner(
    action: string,
    projectId: string,
    actorUserId: string,
    target?: { type: DeveloperItemResourceType; id: string },
  ): Promise<string> {
    const mode = env.security.iamAuthorizationMode;
    if (mode === "legacy") return actorUserId;
    try {
      const identity = await this.actorContext(actorUserId);
      const project = await this.projects.findProjectInAccount(projectId, identity.principal.accountOwnerId);
      if (!project || project.id !== projectId)
        throw new NotFoundError("Project is outside the active account", undefined, {
          messageKey: "developerProject.projectNotFound",
        });
      if (mode === "enforce" && target) {
        const stored = await this.projects.findItemIdentity(target.type, project.id, target.id);
        if (stored && (stored.projectId !== project.id || stored.itemId !== target.id))
          throw new NotFoundError("Resource identifier is not canonical", undefined, {
            messageKey: "developerProject.projectNotFound",
          });
      }
      const start = performance.now(),
        resource = target
          ? developerItemArn(target.type, identity.principal.accountOwnerId, project.id, target.id)
          : this.resource(identity.principal.accountOwnerId, project.id);
      const result = await this.iam.authorize({
        principal: identity.principal,
        action,
        resource,
        context: identity.context,
      });
      this.recordDecision(identity, action, resource, result, start, project.userId === actorUserId);
      if (mode === "enforce") {
        if (result.decision !== "Allow")
          throw new ForbiddenError("Project action denied", undefined, {
            messageKey: "permission.insufficientPermission",
          });
        return project.userId;
      }
    } catch (error) {
      if (mode !== "shadow") throw error;
      getLogger("DeveloperProjectIam", LogCategory.SECURITY).warn("Project action shadow evaluation failed", {
        action,
        reason: "iam-evaluation-unavailable",
        principalUserId: actorUserId,
      });
    }
    return actorUserId;
  }
  async createProject(actorUserId: string, body: CreateDeveloperProjectDto) {
    if (env.security.iamAuthorizationMode !== "legacy") {
      const mode = env.security.iamAuthorizationMode;
      try {
        const identity = await this.actorContext(actorUserId),
          start = performance.now();
        const resource = buildAcsResource({
          service: "quyan",
          region: "*",
          accountId: identity.principal.accountOwnerId,
          path: "user/" + actorUserId,
        });
        const result = await this.iam.authorize({
          principal: identity.principal,
          action: "quyan:developer:CreateProject",
          resource,
          context: identity.context,
        });
        this.recordDecision(identity, "quyan:developer:CreateProject", resource, result, start, true);
        if (mode === "enforce" && result.decision !== "Allow")
          throw new ForbiddenError("Project creation denied", undefined, {
            messageKey: "permission.insufficientPermission",
          });
      } catch (error) {
        if (mode !== "shadow") throw error;
        getLogger("DeveloperProjectIam", LogCategory.SECURITY).warn("Project create shadow evaluation failed", {
          action: "quyan:developer:CreateProject",
          reason: "iam-evaluation-unavailable",
          principalUserId: actorUserId,
        });
      }
    }
    return this.projects.createProject(actorUserId, body);
  }
  async getProject(projectId: string, actorUserId: string) {
    const owner = await this.projectOwner("quyan:developer:GetProject", projectId, actorUserId);
    return this.projects.getProject(projectId, owner);
  }
  async getQuotaSummary(projectId: string, actorUserId: string) {
    const owner = await this.projectOwner("quyan:developer:GetProjectUsage", projectId, actorUserId);
    return this.projects.getQuotaSummary(projectId, owner);
  }
  async updateStatusPage(projectId: string, actorUserId: string, body: UpdateDeveloperStatusPageDto) {
    const owner = await this.projectOwner("quyan:developer:UpdateStatusPage", projectId, actorUserId);
    return this.projects.updateStatusPage(projectId, owner, body);
  }
  private async itemTarget(
    action: string,
    projectId: string,
    actorUserId: string,
    type: DeveloperItemResourceType,
    id: string,
  ) {
    const identity = await this.actorContext(actorUserId);
    const resourceArn = developerItemArn(type, identity.principal.accountOwnerId, projectId, id);
    const owner = await this.projectOwner(action, projectId, actorUserId, { type, id });
    return { owner, resourceArn };
  }

  private async filterResourceRows<T extends { resourceArn: string }>(
    identity: Awaited<ReturnType<DeveloperProjectManagementService["actorContext"]>>,
    action: string,
    items: readonly T[],
    legacyAllowed: boolean,
  ): Promise<T[]> {
    const start = performance.now(),
      policies = await this.iam.loadPolicies(identity.principal);
    const allowed: T[] = [];
    for (const item of items) {
      const result = evaluatePolicies(policies, { action, resource: item.resourceArn, context: identity.context });
      this.recordDecision(identity, action, item.resourceArn, result, start, legacyAllowed);
      if (result.decision === "Allow") allowed.push(item);
    }
    return allowed;
  }
  private async shadowResourceRows<T>(
    actorUserId: string,
    action: string,
    rows: readonly T[],
    resource: (accountOwnerId: string, item: T) => string,
  ) {
    if (env.security.iamAuthorizationMode !== "shadow") return;
    try {
      const identity = await this.actorContext(actorUserId);
      await this.filterResourceRows(
        identity,
        action,
        rows.map((item) => ({ ...item, resourceArn: resource(identity.principal.accountOwnerId, item) })),
        true,
      );
    } catch {
      getLogger("DeveloperProjectIam", LogCategory.SECURITY).warn("Project resource list shadow evaluation failed", {
        action,
        reason: "iam-evaluation-unavailable",
        principalUserId: actorUserId,
      });
    }
  }

  private async resourcePage<T extends { resourceArn?: string }>(
    projectId: string,
    actorUserId: string,
    action: string,
    query: { page?: number; pageSize?: number },
    candidates: (owner: string, options: { skip: number; take: number }) => Promise<T[]>,
    resource: (accountOwnerId: string, item: T) => string,
  ) {
    const pagination = iamManagementPaginationSchema.safeParse(query);
    if (!pagination.success)
      throw new BadRequestError("Invalid project resource pagination", undefined, {
        messageKey: "validation.fieldInvalidValue",
        messageParams: { field: "pagination" },
      });
    const { page, pageSize } = pagination.data,
      mode = env.security.iamAuthorizationMode;
    const identity = await this.actorContext(actorUserId);
    let owner = actorUserId;
    if (mode === "enforce") {
      const project = await this.projects.findProjectInAccount(projectId, identity.principal.accountOwnerId);
      if (!project || project.id !== projectId)
        throw new NotFoundError("Project collection is outside the account", undefined, {
          messageKey: "developerProject.projectNotFound",
        });
      owner = project.userId;
    } else await this.projects.getProject(projectId, actorUserId);
    const rows = await candidates(owner, { skip: (page - 1) * pageSize, take: pageSize + 1 });
    let items = rows
      .slice(0, pageSize)
      .map((item) => ({ ...item, resourceArn: resource(identity.principal.accountOwnerId, item) }));
    if (mode !== "legacy") {
      try {
        const allowed = await this.filterResourceRows(identity, action, items, owner === actorUserId);
        if (mode === "enforce") items = allowed;
      } catch (error) {
        if (mode !== "shadow") throw error;
        getLogger("DeveloperProjectIam", LogCategory.SECURITY).warn("Project resource list shadow evaluation failed", {
          action,
          reason: "iam-evaluation-unavailable",
          principalUserId: actorUserId,
        });
      }
    }
    return { items, page, pageSize, hasNext: rows.length > pageSize };
  }

  async listProjectKvPage(
    projectId: string,
    actorUserId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<DeveloperKvPageDto> {
    return this.resourcePage<Omit<DeveloperKvValueDto, "value">>(
      projectId,
      actorUserId,
      "quyan:developer:ListKv",
      query,
      (owner, options) => this.projects.listKvCandidates(projectId, owner, options),
      (accountOwnerId, item) => developerKvArn(accountOwnerId, projectId, item.key),
    );
  }
  async listProjectKv(projectId: string, actorUserId: string): Promise<Array<Omit<DeveloperKvValueDto, "value">>> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await this.listProjectKvPage(projectId, actorUserId)).items;
    const items = await this.projects.listProjectKv(projectId, actorUserId);
    await this.shadowResourceRows(actorUserId, "quyan:developer:ListKv", items, (accountOwnerId, item) =>
      developerKvArn(accountOwnerId, projectId, item.key),
    );
    return items;
  }
  async getProjectKv(projectId: string, actorUserId: string, key: string): Promise<DeveloperKvValueDto> {
    const target = await this.itemTarget("quyan:developer:GetKv", projectId, actorUserId, "kv-item", key);
    const item =
      env.security.iamAuthorizationMode === "enforce"
        ? await this.projects.getProjectKvReadOnly(projectId, target.owner, key)
        : await this.projects.getProjectKv(projectId, target.owner, key);
    return { ...item, resourceArn: target.resourceArn };
  }
  async setProjectKv(
    projectId: string,
    actorUserId: string,
    key: string,
    body: SetKvValueDto,
  ): Promise<DeveloperKvValueDto> {
    const target = await this.itemTarget("quyan:developer:SetKv", projectId, actorUserId, "kv-item", key);
    return {
      ...(env.security.iamAuthorizationMode === "enforce"
        ? await this.projects.setProjectKvExact(projectId, target.owner, key, body)
        : await this.projects.setProjectKv(projectId, target.owner, key, body)),
      resourceArn: target.resourceArn,
    };
  }
  async deleteProjectKv(projectId: string, actorUserId: string, key: string): Promise<void> {
    const target = await this.itemTarget("quyan:developer:DeleteKv", projectId, actorUserId, "kv-item", key);
    return env.security.iamAuthorizationMode === "enforce"
      ? this.projects.deleteProjectKvExact(projectId, target.owner, key)
      : this.projects.deleteProjectKv(projectId, target.owner, key);
  }
  async listSecretsPage(
    projectId: string,
    actorUserId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<DeveloperSecretPageDto> {
    return this.resourcePage<DeveloperSecretDto>(
      projectId,
      actorUserId,
      "quyan:developer:ListSecrets",
      query,
      (owner, options) => this.projects.listSecretCandidates(projectId, owner, options),
      (accountOwnerId, item) => developerSecretArn(accountOwnerId, projectId, item.alias),
    );
  }
  async listSecrets(projectId: string, actorUserId: string): Promise<DeveloperSecretDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await this.listSecretsPage(projectId, actorUserId)).items;
    const items = await this.projects.listSecrets(projectId, actorUserId);
    await this.shadowResourceRows(actorUserId, "quyan:developer:ListSecrets", items, (accountOwnerId, item) =>
      developerSecretArn(accountOwnerId, projectId, item.alias),
    );
    return items;
  }
  async upsertSecret(
    projectId: string,
    actorUserId: string,
    body: UpsertDeveloperSecretDto,
  ): Promise<DeveloperSecretDto> {
    const target = await this.itemTarget("quyan:developer:PutSecret", projectId, actorUserId, "secret", body.alias);
    return { ...(await this.projects.upsertSecret(projectId, target.owner, body)), resourceArn: target.resourceArn };
  }
  async deleteSecret(projectId: string, alias: string, actorUserId: string): Promise<void> {
    const target = await this.itemTarget("quyan:developer:DeleteSecret", projectId, actorUserId, "secret", alias);
    return this.projects.deleteSecret(projectId, alias, target.owner);
  }
  async listShortLinksPage(
    projectId: string,
    actorUserId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<DeveloperShortLinkPageDto> {
    return this.resourcePage<DeveloperShortLinkDto>(
      projectId,
      actorUserId,
      "quyan:developer:ListShortLinks",
      query,
      (owner, options) => this.projects.listShortLinkCandidates(projectId, owner, options),
      (accountOwnerId, item) => developerShortLinkArn(accountOwnerId, projectId, item.id),
    );
  }
  async listShortLinks(projectId: string, actorUserId: string): Promise<DeveloperShortLinkDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await this.listShortLinksPage(projectId, actorUserId)).items;
    const items = await this.projects.listShortLinks(projectId, actorUserId);
    await this.shadowResourceRows(actorUserId, "quyan:developer:ListShortLinks", items, (accountOwnerId, item) =>
      developerShortLinkArn(accountOwnerId, projectId, item.id),
    );
    return items;
  }
  async createShortLink(
    projectId: string,
    actorUserId: string,
    body: CreateShortLinkDto,
  ): Promise<DeveloperShortLinkDto> {
    const identity = await this.actorContext(actorUserId);
    const owner = await this.projectOwner("quyan:developer:CreateShortLink", projectId, actorUserId);
    const item = await this.projects.createShortLink(projectId, owner, body);
    return { ...item, resourceArn: developerShortLinkArn(identity.principal.accountOwnerId, projectId, item.id) };
  }
  async updateShortLink(
    projectId: string,
    linkId: string,
    actorUserId: string,
    body: UpdateShortLinkDto,
  ): Promise<DeveloperShortLinkDto> {
    const target = await this.itemTarget(
      "quyan:developer:UpdateShortLink",
      projectId,
      actorUserId,
      "short-link",
      linkId,
    );
    const item = await this.projects.updateShortLink(projectId, linkId, target.owner, body, {
      activeOnly: env.security.iamAuthorizationMode === "enforce",
    });
    return { ...item, resourceArn: target.resourceArn };
  }
  async deleteShortLink(projectId: string, linkId: string, actorUserId: string): Promise<void> {
    const target = await this.itemTarget(
      "quyan:developer:DeleteShortLink",
      projectId,
      actorUserId,
      "short-link",
      linkId,
    );
    await this.projects.deleteShortLink(projectId, linkId, target.owner, {
      activeOnly: env.security.iamAuthorizationMode === "enforce",
    });
  }
  async getShortLinkStats(projectId: string, linkId: string, actorUserId: string): Promise<DeveloperShortLinkStatsDto> {
    const target = await this.itemTarget(
      "quyan:developer:GetShortLinkStats",
      projectId,
      actorUserId,
      "short-link",
      linkId,
    );
    const item = await this.projects.getShortLinkStats(projectId, linkId, target.owner, undefined, undefined, {
      activeOnly: env.security.iamAuthorizationMode === "enforce",
    });
    return { ...item, resourceArn: target.resourceArn };
  }
  async listProjectApiKeysPage(
    projectId: string,
    actorUserId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<DeveloperApiKeyPageDto> {
    return this.resourcePage<Omit<DeveloperApiKeyDto, "key">>(
      projectId,
      actorUserId,
      "quyan:developer:ListProjectApiKeys",
      query,
      (owner, options) => this.projects.listProjectApiKeyCandidates(projectId, owner, options),
      (accountOwnerId, item) => developerProjectApiKeyArn(accountOwnerId, projectId, item.id),
    );
  }
  async listProjectApiKeys(projectId: string, actorUserId: string): Promise<DeveloperApiKeyDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await this.listProjectApiKeysPage(projectId, actorUserId)).items;
    const items = await this.projects.listProjectApiKeys(projectId, actorUserId);
    await this.shadowResourceRows(actorUserId, "quyan:developer:ListProjectApiKeys", items, (accountOwnerId, item) =>
      developerProjectApiKeyArn(accountOwnerId, projectId, item.id),
    );
    return items;
  }
  async revokeProjectApiKey(projectId: string, keyId: string, actorUserId: string): Promise<void> {
    const target = await this.itemTarget(
      "quyan:developer:RevokeProjectApiKey",
      projectId,
      actorUserId,
      "project-api-key",
      keyId,
    );
    await this.projects.revokeProjectApiKey(projectId, keyId, target.owner, {
      activeOnly: env.security.iamAuthorizationMode === "enforce",
    });
  }
  async listStatusMonitorsPage(
    projectId: string,
    actorUserId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<DeveloperStatusMonitorPageDto> {
    return this.resourcePage<DeveloperStatusMonitorDto>(
      projectId,
      actorUserId,
      "quyan:developer:ListStatusMonitors",
      query,
      (owner, options) => this.projects.listStatusMonitorCandidates(projectId, owner, options),
      (accountOwnerId, item) => developerStatusMonitorArn(accountOwnerId, projectId, item.id),
    );
  }
  async listStatusMonitors(projectId: string, actorUserId: string): Promise<DeveloperStatusMonitorDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await this.listStatusMonitorsPage(projectId, actorUserId)).items;
    const items = await this.projects.listStatusMonitors(projectId, actorUserId);
    await this.shadowResourceRows(actorUserId, "quyan:developer:ListStatusMonitors", items, (accountOwnerId, item) =>
      developerStatusMonitorArn(accountOwnerId, projectId, item.id),
    );
    return items;
  }
  async createStatusMonitor(
    projectId: string,
    actorUserId: string,
    body: CreateDeveloperStatusMonitorDto,
  ): Promise<DeveloperStatusMonitorDto> {
    const identity = await this.actorContext(actorUserId);
    const owner = await this.projectOwner("quyan:developer:CreateStatusMonitor", projectId, actorUserId);
    const item = await this.projects.createStatusMonitor(projectId, owner, body, {
      activeOnly: env.security.iamAuthorizationMode === "enforce",
    });
    return { ...item, resourceArn: developerStatusMonitorArn(identity.principal.accountOwnerId, projectId, item.id) };
  }
  async updateStatusMonitor(
    projectId: string,
    monitorId: string,
    actorUserId: string,
    body: UpdateDeveloperStatusMonitorDto,
  ): Promise<DeveloperStatusMonitorDto> {
    const target = await this.itemTarget(
      "quyan:developer:UpdateStatusMonitor",
      projectId,
      actorUserId,
      "status-monitor",
      monitorId,
    );
    const item = await this.projects.updateStatusMonitor(projectId, monitorId, target.owner, body, {
      activeOnly: env.security.iamAuthorizationMode === "enforce",
    });
    return { ...item, resourceArn: target.resourceArn };
  }
  async deleteStatusMonitor(projectId: string, monitorId: string, actorUserId: string): Promise<void> {
    const target = await this.itemTarget(
      "quyan:developer:DeleteStatusMonitor",
      projectId,
      actorUserId,
      "status-monitor",
      monitorId,
    );
    await this.projects.deleteStatusMonitor(projectId, monitorId, target.owner, {
      activeOnly: env.security.iamAuthorizationMode === "enforce",
    });
  }
  async checkStatusMonitor(
    projectId: string,
    monitorId: string,
    actorUserId: string,
  ): Promise<DeveloperStatusMonitorDto> {
    const target = await this.itemTarget(
      "quyan:developer:CheckStatusMonitor",
      projectId,
      actorUserId,
      "status-monitor",
      monitorId,
    );
    const item = await this.projects.checkStatusMonitor(projectId, monitorId, target.owner, {
      activeOnly: env.security.iamAuthorizationMode === "enforce",
    });
    return { ...item, resourceArn: target.resourceArn };
  }
  async listPushChannelsPage(
    projectId: string,
    actorUserId: string,
    query: { page?: number; pageSize?: number } = {},
  ): Promise<DeveloperPushChannelPageDto> {
    return this.resourcePage<DeveloperPushChannelDto>(
      projectId,
      actorUserId,
      "quyan:developer:ListPushChannels",
      query,
      (owner, options) => this.channels.listCandidates(projectId, owner, options),
      (accountOwnerId, item) => developerPushChannelArn(accountOwnerId, projectId, item.id),
    );
  }
  async listPushChannels(projectId: string, actorUserId: string): Promise<DeveloperPushChannelDto[]> {
    if (env.security.iamAuthorizationMode === "enforce")
      return (await this.listPushChannelsPage(projectId, actorUserId)).items;
    const items = await this.projects.listPushChannels(projectId, actorUserId);
    await this.shadowResourceRows(actorUserId, "quyan:developer:ListPushChannels", items, (owner, item) =>
      developerPushChannelArn(owner, projectId, item.id),
    );
    return items;
  }
  private async channelSecretGrant(
    owner: string,
    actorUserId: string,
    reference: DeveloperPushSecretReferenceDto,
    expectedProjectId?: string,
  ): Promise<ResolvedPushSecretBinding | undefined> {
    const mode = env.security.iamAuthorizationMode;
    if (mode === "legacy") return undefined;
    try {
      const binding = await this.channels.findSecretBinding(owner, reference);
      if (expectedProjectId && binding.secretProjectId !== expectedProjectId)
        throw new ForbiddenError("Stored Secret binding no longer matches its instance", undefined, {
          messageKey: "permission.insufficientPermission",
        });
      const target = await this.itemTarget(
        "quyan:developer:UseSecret",
        binding.secretProjectId,
        actorUserId,
        "secret",
        binding.alias,
      );
      if (mode === "enforce" && target.owner !== owner)
        throw new ForbiddenError("Secret binding owner mismatch", undefined, {
          messageKey: "permission.insufficientPermission",
        });
      return binding;
    } catch (error) {
      if (mode !== "shadow") throw error;
      getLogger("DeveloperProjectIam", LogCategory.SECURITY).warn("Push Secret shadow evaluation failed", {
        action: "quyan:developer:UseSecret",
        principalUserId: actorUserId,
        reason: "iam-evaluation-unavailable",
      });
      return undefined;
    }
  }
  async createPushChannel(
    projectId: string,
    actorUserId: string,
    body: CreateDeveloperPushChannelDto,
  ): Promise<DeveloperPushChannelDto> {
    const owner = await this.projectOwner("quyan:developer:CreatePushChannel", projectId, actorUserId);
    const binding = body.secretReference
      ? await this.channelSecretGrant(owner, actorUserId, body.secretReference)
      : undefined;
    if (env.security.iamAuthorizationMode !== "enforce") return this.projects.createPushChannel(projectId, owner, body);
    const identity = await this.actorContext(actorUserId);
    const item = await this.channels.create(projectId, owner, body, binding);
    return { ...item, resourceArn: developerPushChannelArn(identity.principal.accountOwnerId, projectId, item.id) };
  }
  async updatePushChannel(
    projectId: string,
    channelId: string,
    actorUserId: string,
    body: UpdateDeveloperPushChannelDto,
  ): Promise<DeveloperPushChannelDto> {
    const target = await this.itemTarget(
      "quyan:developer:UpdatePushChannel",
      projectId,
      actorUserId,
      "push-channel",
      channelId,
    );
    if (env.security.iamAuthorizationMode === "legacy")
      return this.projects.updatePushChannel(projectId, channelId, target.owner, body);
    let snapshot: Awaited<ReturnType<DeveloperPushChannelRepository["snapshot"]>>;
    let binding: ResolvedPushSecretBinding | undefined;
    try {
      snapshot = await this.channels.snapshot(projectId, target.owner, channelId);
      if (requiresPushSecretAuthority(body, snapshot)) {
        const reference = body.secretReference ?? pushChannelSecretReferenceDto(snapshot);
        if (!reference)
          throw new ForbiddenError("Credential binding must be reselected", undefined, {
            messageKey: "permission.insufficientPermission",
          });
        const expectedProjectId =
          body.secretReference === undefined
            ? readStoredPushSecretReference(snapshot.config)?.secretProjectId
            : undefined;
        binding = await this.channelSecretGrant(target.owner, actorUserId, reference, expectedProjectId);
      }
    } catch (error) {
      if (env.security.iamAuthorizationMode !== "shadow") throw error;
      getLogger("DeveloperProjectIam", LogCategory.SECURITY).warn("Push channel shadow evaluation failed", {
        action: "quyan:developer:UpdatePushChannel",
        principalUserId: actorUserId,
        reason: "iam-evaluation-unavailable",
      });
      return this.projects.updatePushChannel(projectId, channelId, target.owner, body);
    }
    if (env.security.iamAuthorizationMode === "shadow")
      return this.projects.updatePushChannel(projectId, channelId, target.owner, body);
    const item = await this.channels.update(snapshot, target.owner, body, binding);
    return { ...item, resourceArn: target.resourceArn };
  }
  async deletePushChannel(projectId: string, channelId: string, actorUserId: string): Promise<void> {
    const target = await this.itemTarget(
      "quyan:developer:DeletePushChannel",
      projectId,
      actorUserId,
      "push-channel",
      channelId,
    );
    if (env.security.iamAuthorizationMode === "enforce")
      return this.channels.delete(projectId, target.owner, channelId);
    return this.projects.deletePushChannel(projectId, channelId, target.owner);
  }
}
