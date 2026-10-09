import type { Article } from "@prisma/client";
import type { UpdateArticleDto } from "@/api/dto/article/article.dto";
import { assertArticlePublicAccess, normalizeArticleUpdate } from "./article-validation";
import { Permission, actionForPermission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { articleArn } from "@/iam/resources/article-resources";
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
  private async authorizedTarget(id: string, actorUserId: string, request: TypedRequest, permission: Permission) {
    const principal = getIamPrincipal(request);
    if (!principal || principal.subjectUserId !== actorUserId || principal.principalUserId !== actorUserId)
      throw new ForbiddenError("Invalid article management identity", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    const target = await this.repository.findTarget(id, principal.accountOwnerId);
    if (!target)
      throw new NotFoundError("Article management target unavailable", undefined, { messageKey: "article.notFound" });
    const action = actionForPermission(permission),
      resource = articleArn(principal.accountOwnerId, target.id),
      start = performance.now();
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
    return { target, principal };
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
}
