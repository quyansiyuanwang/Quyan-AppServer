import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { MANAGED_STATUS } from "@/constant/status";
import { isCanonicalArticleId } from "@/iam/resources/article-resources";
import type { UpdateArticleDto } from "@/api/dto/article/article.dto";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";

const managementSelect = {
  id: true,
  slug: true,
  isDefault: true,
  sortOrder: true,
  authorId: true,
  publishStatus: true,
  publishedAt: true,
  isPublic: true,
  requirePermission: true,
  updateTime: true,
} satisfies Prisma.ArticleSelect;
export type ArticleManagementTarget = Prisma.ArticleGetPayload<{ select: typeof managementSelect }>;
type ArticleManagementClient = Pick<Prisma.TransactionClient, "article" | "user">;
const unavailable = () =>
  new NotFoundError("Article management target unavailable", undefined, { messageKey: "article.notFound" });

/** Metadata-only resolution; SQL collation must not create additional IAM identities. */
export class ArticleManagementRepository {
  private static instance: ArticleManagementRepository;
  static getInstance() {
    return (this.instance ??= new ArticleManagementRepository());
  }
  async findTarget(
    id: string,
    accountOwnerId: string,
    client: ArticleManagementClient = prisma,
  ): Promise<ArticleManagementTarget | undefined> {
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
      select: managementSelect,
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
  /** All management mutations share a live actor/ownership check and exact authorized snapshot. */
  async assertAuthorizedTarget(
    tx: ArticleManagementClient,
    target: ArticleManagementTarget,
    accountOwnerId: string,
    actorUserId: string,
  ): Promise<void> {
    const actor = await tx.user.findFirst({
      where: { id: actorUserId, status: MANAGED_STATUS.ENABLED },
      select: { id: true, accountOwnerId: true },
    });
    if (!actor || actor.id !== actorUserId || (actor.accountOwnerId || actor.id) !== accountOwnerId)
      throw new ForbiddenError("Article management actor unavailable", undefined, {
        messageKey: "permission.insufficientPermission",
      });
    const current = await this.findTarget(target.id, accountOwnerId, tx);
    if (
      !current ||
      current.authorId !== target.authorId ||
      current.slug !== target.slug ||
      current.isDefault !== target.isDefault ||
      current.sortOrder !== target.sortOrder ||
      current.publishStatus !== target.publishStatus ||
      current.publishedAt?.getTime() !== target.publishedAt?.getTime() ||
      current.isPublic !== target.isPublic ||
      current.requirePermission !== target.requirePermission ||
      current.updateTime.getTime() !== target.updateTime.getTime()
    )
      throw unavailable();
  }
  async transition(
    target: ArticleManagementTarget,
    accountOwnerId: string,
    actorUserId: string,
    next: "draft" | "published",
  ) {
    return prisma.$transaction(
      async (tx) => {
        await this.assertAuthorizedTarget(tx, target, accountOwnerId, actorUserId);
        return tx.article.update({
          where: { id: target.id, status: MANAGED_STATUS.ENABLED },
          data: { publishStatus: next, ...(next === "published" ? { publishedAt: new Date() } : {}) },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async update(
    target: ArticleManagementTarget,
    accountOwnerId: string,
    actorUserId: string,
    changes: UpdateArticleDto,
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.assertAuthorizedTarget(tx, target, accountOwnerId, actorUserId);
          if (changes.slug !== undefined && changes.slug !== target.slug) {
            const existing = await tx.article.findFirst({ where: { slug: changes.slug }, select: { id: true } });
            if (existing && existing.id !== target.id)
              throw new BadRequestError("Slug already exists", undefined, { messageKey: "article.slugExists" });
          }
          // No caller-supplied publication state, author, status, default flag or counters can enter persistence.
          return tx.article.update({
            where: { id: target.id, status: MANAGED_STATUS.ENABLED },
            data: {
              title: changes.title,
              slug: changes.slug,
              category: changes.category,
              summary: changes.summary,
              content: changes.content,
              isPublic: changes.isPublic,
              requirePermission: changes.requirePermission,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new BadRequestError("Slug already exists", undefined, { messageKey: "article.slugExists" });
      throw error;
    }
  }
  async delete(target: ArticleManagementTarget, accountOwnerId: string, actorUserId: string) {
    return prisma.$transaction(
      async (tx) => {
        await this.assertAuthorizedTarget(tx, target, accountOwnerId, actorUserId);
        return tx.article.update({
          where: { id: target.id, status: MANAGED_STATUS.ENABLED },
          data: { status: MANAGED_STATUS.DELETED },
          select: { id: true, title: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
