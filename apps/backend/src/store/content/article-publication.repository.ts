import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { MANAGED_STATUS } from "@/constant/status";
import { isCanonicalArticleId } from "@/iam/resources/article-resources";
import { ForbiddenError, NotFoundError } from "@/util/errors";

const publicationSelect = {
  id: true,
  authorId: true,
  publishStatus: true,
  publishedAt: true,
  isPublic: true,
  requirePermission: true,
  updateTime: true,
} satisfies Prisma.ArticleSelect;
export type ArticlePublicationTarget = Prisma.ArticleGetPayload<{ select: typeof publicationSelect }>;
type PublicationClient = Pick<Prisma.TransactionClient, "article" | "user">;
const unavailable = () =>
  new NotFoundError("Article publication target unavailable", undefined, { messageKey: "article.notFound" });

/** Metadata-only resolution; SQL collation must not create additional IAM identities. */
export class ArticlePublicationRepository {
  private static instance: ArticlePublicationRepository;
  static getInstance() {
    return (this.instance ??= new ArticlePublicationRepository());
  }
  async findTarget(
    id: string,
    accountOwnerId: string,
    client: PublicationClient = prisma,
  ): Promise<ArticlePublicationTarget | undefined> {
    if (!isCanonicalArticleId(id)) return undefined;
    const article = await client.article.findFirst({
      where: {
        id,
        status: MANAGED_STATUS.ENABLED,
        author: {
          status: MANAGED_STATUS.ENABLED,
          OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }],
        },
      },
      select: publicationSelect,
    });
    if (!article || article.id !== id) return undefined;
    const author = await client.user.findFirst({
      where: { id: article.authorId, status: MANAGED_STATUS.ENABLED },
      select: { id: true, accountOwnerId: true },
    });
    const owner = await client.user.findFirst({
      where: { id: accountOwnerId, status: MANAGED_STATUS.ENABLED },
      select: { id: true },
    });
    if (
      !author ||
      author.id !== article.authorId ||
      (author.accountOwnerId || author.id) !== accountOwnerId ||
      owner?.id !== accountOwnerId
    )
      return undefined;
    return article;
  }
  async transition(
    target: ArticlePublicationTarget,
    accountOwnerId: string,
    actorUserId: string,
    next: "draft" | "published",
  ) {
    return prisma.$transaction(
      async (tx) => {
        const actor = await tx.user.findFirst({
          where: { id: actorUserId, status: MANAGED_STATUS.ENABLED },
          select: { id: true, accountOwnerId: true },
        });
        if (!actor || actor.id !== actorUserId || (actor.accountOwnerId || actor.id) !== accountOwnerId)
          throw new ForbiddenError("Publication actor unavailable", undefined, {
            messageKey: "permission.insufficientPermission",
          });
        const current = await this.findTarget(target.id, accountOwnerId, tx);
        if (
          !current ||
          current.authorId !== target.authorId ||
          current.publishStatus !== target.publishStatus ||
          current.publishedAt?.getTime() !== target.publishedAt?.getTime() ||
          current.isPublic !== target.isPublic ||
          current.requirePermission !== target.requirePermission ||
          current.updateTime.getTime() !== target.updateTime.getTime()
        )
          throw unavailable();
        return tx.article.update({
          where: { id: target.id, status: MANAGED_STATUS.ENABLED },
          data: { publishStatus: next, ...(next === "published" ? { publishedAt: new Date() } : {}) },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
