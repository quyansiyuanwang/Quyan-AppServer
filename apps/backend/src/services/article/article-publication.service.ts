import type { Article } from "@prisma/client";
import { Permission, actionForPermission } from "@quyan/shared";
import type { TypedRequest } from "@/types/express";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { articleArn } from "@/iam/resources/article-resources";
import { ArticlePublicationRepository } from "@/store/content/article-publication.repository";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";

/** Enforce-only lifecycle boundary. Public reading and site-wide default selection are separate capabilities. */
export class ArticlePublicationService {
  private static instance: ArticlePublicationService;
  private constructor(
    private readonly repository = ArticlePublicationRepository.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new ArticlePublicationService());
  }
  async transition(
    id: string,
    actorUserId: string,
    request: TypedRequest,
    next: "draft" | "published",
  ): Promise<Article> {
    const principal = getIamPrincipal(request);
    if (!principal || principal.subjectUserId !== actorUserId || principal.principalUserId !== actorUserId)
      throw new ForbiddenError("Invalid publication identity", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    const target = await this.repository.findTarget(id, principal.accountOwnerId);
    if (!target)
      throw new NotFoundError("Article publication target unavailable", undefined, { messageKey: "article.notFound" });
    const action = actionForPermission(Permission.ARTICLE_PUBLISH),
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
      throw new ForbiddenError("Article publication denied", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    if (target.publishStatus === next)
      throw new BadRequestError("Article publication state is unchanged", undefined, {
        messageKey: next === "published" ? "article.alreadyPublished" : "article.alreadyDraft",
      });
    if (target.publishStatus !== "draft" && target.publishStatus !== "published")
      throw new NotFoundError("Unsupported publication state", undefined, { messageKey: "article.notFound" });
    return this.repository.transition(target, principal.accountOwnerId, actorUserId, next);
  }
}
