import type { Article } from "@prisma/client";
import type { CreateArticleDto, ReorderArticleItem, UpdateArticleDto } from "@/api/dto/article/article.dto";
import {
  assertArticlePublicAccess,
  normalizeArticleCreate,
  normalizeArticleListFilters,
  normalizeArticleReorder,
  normalizeArticleUpdate,
} from "./article-validation";
import { Permission, actionForPermission, type IamPrincipal } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
import { requestConditionContext } from "@/iam/request/condition-context";
import { articleArn, isCanonicalArticleId } from "@/iam/resources/article-resources";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import type { ArticleManagementListRow } from "@/store/content/article-management.repository";
import { ArticleManagementRepository } from "@/store/content/article-management.repository";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";

/** Enforce-only management boundary. Public reading and site-wide default selection are separate capabilities. */
export class ArticleManagementService {
  private static instance: ArticleManagementService;
  private constructor(
    private readonly repository = ArticleManagementRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new ArticleManagementService());
  }
  private principalForActor(actorUserId: string, request: TypedRequest): IamPrincipal {
    const principal = getIamPrincipal(request);
    if (!principal || principal.subjectUserId !== actorUserId || principal.principalUserId !== actorUserId)
      throw new ForbiddenError("Invalid article management identity", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    return principal;
  }
  private async authorizeResource(principal: IamPrincipal, action: string, resource: string, request: TypedRequest) {
    const start = performance.now();
    const result = await this.iam.authorize({
      principal,
      action,
      resource,
      context: requestConditionContext(request, principal),
    });
    (request.iamDecisions ??= []).push({ ...result, action, resource });
    auditIamDecision({
      requestId: request.res?.locals.requestId,
      principal,
      action,
      resource,
      result,
      evaluationLatencyMs: performance.now() - start,
      authorizationMode: "enforce",
    });
    if (result.decision !== "Allow")
      throw new ForbiddenError("Article management denied", undefined, {
        messageKey: "permission.insufficientPermission",
      });
  }
  private async authorizedTarget(id: string, actorUserId: string, request: TypedRequest, permission: Permission) {
    const principal = this.principalForActor(actorUserId, request);
    const target = await this.repository.findTarget(id, principal.accountOwnerId);
    if (!target)
      throw new NotFoundError("Article management target unavailable", undefined, { messageKey: "article.notFound" });
    await this.authorizeResource(
      principal,
      actionForPermission(permission),
      articleArn(principal.accountOwnerId, target.id),
      request,
    );
    return { target, principal };
  }
  async create(input: CreateArticleDto, actorUserId: string, request: TypedRequest): Promise<Article> {
    const principal = this.principalForActor(actorUserId, request);
    const resource = await ramAccountResourceResolver({ request, principal });
    if (!resource)
      throw new ForbiddenError("Article parent account unavailable", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    await this.authorizeResource(principal, actionForPermission(Permission.ARTICLE_CREATE), resource, request);
    const changes = normalizeArticleCreate(input);
    assertArticlePublicAccess(changes.isPublic ?? false, changes.requirePermission);
    return this.repository.create(changes, principal.accountOwnerId, actorUserId);
  }
  async list(
    actorUserId: string,
    request: TypedRequest,
    inputFilters: unknown = {},
    legacyAllowedIds?: ReadonlySet<string>,
  ): Promise<ArticleManagementListRow[]> {
    const principal = this.principalForActor(actorUserId, request);
    const filters = normalizeArticleListFilters(inputFilters);
    await this.iam.loadPolicies(principal);
    const action = "quyan:article:ListArticles";
    const context = requestConditionContext(request, principal);
    const accepted: ArticleManagementListRow[] = [];
    let afterId: string | undefined;
    while (true) {
      const page = await this.repository.listPage(principal.accountOwnerId, filters, afterId);
      if (!page.length) break;
      const candidates = await this.repository.currentListRows(
        page.filter((row) => isCanonicalArticleId(row.id)),
        principal.accountOwnerId,
      );
      if (!candidates.length) {
        afterId = page[page.length - 1].id;
        if (page.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
        continue;
      }
      const resources = candidates.map((row) => articleArn(principal.accountOwnerId, row.id));
      const start = performance.now();
      const results = await this.iam.authorizeMany({ principal, action, resources, context });
      if (results.length !== candidates.length || Array.from(results).some((result) => !result))
        throw new ForbiddenError("Article list decisions unavailable", undefined, {
          messageKey: "permission.insufficientPermission",
        });
      results.forEach((result, index) => {
        const resource = resources[index];
        (request.iamDecisions ??= []).push({ ...result, action, resource });
        auditIamDecision({
          requestId: request.res?.locals.requestId,
          principal,
          action,
          resource,
          result,
          evaluationLatencyMs: performance.now() - start,
          authorizationMode: legacyAllowedIds ? "shadow" : "enforce",
          ...(legacyAllowedIds ? { legacyAllowed: legacyAllowedIds.has(candidates[index].id) } : {}),
          batchSize: candidates.length,
          batchIndex: index,
        });
      });
      const allowed = candidates.filter((_, index) => results[index].decision === "Allow");
      accepted.push(...(await this.repository.currentListRows(allowed, principal.accountOwnerId)));
      afterId = page[page.length - 1].id;
      if (page.length < IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) break;
    }
    // An empty collection is not a way to bypass identity/session validity.
    await this.iam.loadPolicies(principal);
    return accepted.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        right.createTime.getTime() - left.createTime.getTime() ||
        left.id.localeCompare(right.id),
    );
  }
  async transition(
    id: string,
    actorUserId: string,
    request: TypedRequest,
    next: "draft" | "published",
  ): Promise<Article> {
    const { target, principal } = await this.authorizedTarget(id, actorUserId, request, Permission.ARTICLE_PUBLISH);
    if (target.publishStatus === next)
      throw new BadRequestError("Article publication state is unchanged", undefined, {
        messageKey: next === "published" ? "article.alreadyPublished" : "article.alreadyDraft",
      });
    if (target.publishStatus !== "draft" && target.publishStatus !== "published")
      throw new NotFoundError("Unsupported publication state", undefined, { messageKey: "article.notFound" });
    return this.repository.transition(target, principal.accountOwnerId, actorUserId, next);
  }
  async update(id: string, input: UpdateArticleDto, actorUserId: string, request: TypedRequest): Promise<Article> {
    const { target, principal } = await this.authorizedTarget(id, actorUserId, request, Permission.ARTICLE_UPDATE);
    const changes = normalizeArticleUpdate(input);
    assertArticlePublicAccess(
      changes.isPublic ?? target.isPublic,
      changes.requirePermission ?? target.requirePermission ?? undefined,
    );
    return this.repository.update(target, principal.accountOwnerId, actorUserId, changes);
  }
  async delete(id: string, actorUserId: string, request: TypedRequest) {
    const { target, principal } = await this.authorizedTarget(id, actorUserId, request, Permission.ARTICLE_DELETE);
    return this.repository.delete(target, principal.accountOwnerId, actorUserId);
  }
  async reorder(input: ReorderArticleItem[], actorUserId: string, request: TypedRequest): Promise<void> {
    const principal = getIamPrincipal(request);
    if (!principal || principal.subjectUserId !== actorUserId || principal.principalUserId !== actorUserId)
      throw new ForbiddenError("Invalid article reorder identity", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    const items = normalizeArticleReorder(input);
    const targets = await this.repository.findTargets(
      items.map((item) => item.id),
      principal.accountOwnerId,
    );
    if (!targets)
      throw new NotFoundError("Article reorder targets unavailable", undefined, { messageKey: "article.notFound" });
    const action = "quyan:article:ReorderArticles",
      resources = targets.map((target) => articleArn(principal.accountOwnerId, target.id)),
      start = performance.now();
    const results = await this.iam.authorizeMany({
      principal,
      action,
      resources,
      context: requestConditionContext(request, principal),
    });
    if (results.length !== resources.length || Array.from(results).some((result) => !result))
      throw new ForbiddenError("Article reorder decision batch unavailable", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    // Preserve all decisions for audit, including denied elements; no mutation runs until ALL are Allow.
    results.forEach((result, index) => {
      const resource = resources[index];
      (request.iamDecisions ??= []).push({ ...result, action, resource });
      auditIamDecision({
        requestId: request.res?.locals.requestId,
        principal,
        action,
        resource,
        result,
        evaluationLatencyMs: performance.now() - start,
        authorizationMode: "enforce",
        batchSize: resources.length,
        batchIndex: index,
      });
    });
    if (results.some((result) => result.decision !== "Allow"))
      throw new ForbiddenError("Article reorder batch denied", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    await this.repository.reorder(
      items.map((item, index) => ({ target: targets[index], sortOrder: item.sortOrder })),
      principal.accountOwnerId,
      actorUserId,
    );
  }
}
