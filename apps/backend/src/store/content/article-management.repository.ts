import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { MANAGED_STATUS } from "@/constant/status";
import { isCanonicalArticleId } from "@/iam/resources/article-resources";
import type { CreateArticleDto, UpdateArticleDto } from "@/api/dto/article/article.dto";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@/util/errors";

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
  /** The article has no ARN yet: persist only after rechecking the trusted actor and parent account. */
  async create(changes: CreateArticleDto, accountOwnerId: string, actorUserId: string) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const actor = await tx.user.findFirst({
            where: { id: actorUserId, status: MANAGED_STATUS.ENABLED },
            select: { id: true, accountOwnerId: true },
          });
          const owner = await tx.user.findFirst({
            where: { id: accountOwnerId, status: MANAGED_STATUS.ENABLED },
            select: { id: true, accountOwnerId: true },
          });
          // Exact equality is required even when MySQL collation accepts a case alias.
          if (
            !actor ||
            actor.id !== actorUserId ||
            (actor.accountOwnerId || actor.id) !== accountOwnerId ||
            !owner ||
            owner.id !== accountOwnerId ||
            (owner.accountOwnerId || owner.id) !== accountOwnerId
          )
            throw new ForbiddenError("Article creation account or actor unavailable", undefined, {
              messageKey: "permission.insufficientPermission",
            });
          const existing = await tx.article.findFirst({ where: { slug: changes.slug }, select: { id: true } });
          if (existing)
            throw new BadRequestError("Slug already exists", undefined, { messageKey: "article.slugExists" });
          return tx.article.create({
            data: {
              title: changes.title,
              slug: changes.slug,
              category: changes.category,
              summary: changes.summary,
              content: changes.content,
              isPublic: changes.isPublic,
              requirePermission: changes.requirePermission,
              authorId: actorUserId,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002")
          throw new BadRequestError("Slug already exists", undefined, { messageKey: "article.slugExists" });
        if (error.code === "P2034")
          throw new ConflictError("Article creation conflicted", undefined, { messageKey: "errors.conflict" });
      }
      throw error;
    }
  }
  async findTarget(
    id: string,
    accountOwnerId: string,
    client: ArticleManagementClient = prisma,
  ): Promise<ArticleManagementTarget | undefined> {
    return (await this.findTargets([id], accountOwnerId, client))?.[0];
  }
  /** Bounded scalar batch projection; maintain requested order without accepting SQL collation aliases. */
  async findTargets(
    ids: readonly string[],
    accountOwnerId: string,
    client: ArticleManagementClient = prisma,
  ): Promise<ArticleManagementTarget[] | undefined> {
    if (!ids.length) return undefined;
    const available = await this.findAvailableTargets(ids, accountOwnerId, client);
    const byId = new Map(available.map((row) => [row.id, row]));
    const ordered = ids.map((id) => byId.get(id));
    if (ordered.some((row) => !row)) return undefined;
    return ordered as ArticleManagementTarget[];
  }
  /** Independent metadata projection for list/condition evaluation: invalid siblings do not hide valid rows. */
  async findAvailableTargets(
    ids: readonly string[],
    accountOwnerId: string,
    client: ArticleManagementClient = prisma,
  ): Promise<ArticleManagementTarget[]> {
    if (
      !ids.length ||
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(ids).size !== ids.length ||
      !Array.from(ids).every(isCanonicalArticleId)
    )
      return [];
    const records = await client.article.findMany({
      where: {
        id: { in: [...ids] },
        status: MANAGED_STATUS.ENABLED,
        author: {
          status: MANAGED_STATUS.ENABLED,
          OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }],
        },
      },
      select: managementSelect,
      orderBy: { id: "asc" },
    });

    const authors = await client.user.findMany({
      where: { id: { in: [...new Set(records.map((row) => row.authorId))] }, status: MANAGED_STATUS.ENABLED },
      select: { id: true, accountOwnerId: true },
    });
    const owner = await client.user.findFirst({
      where: { id: accountOwnerId, status: MANAGED_STATUS.ENABLED },
      select: { id: true },
    });
    if (owner?.id !== accountOwnerId) return [];
    const canonicalAuthors = new Set(
      authors.filter((author) => (author.accountOwnerId || author.id) === accountOwnerId).map((author) => author.id),
    );
    const requested = new Set(ids);
    return records.filter((row) => requested.has(row.id) && canonicalAuthors.has(row.authorId));
  }
  /** All management mutations share a live actor/ownership check and exact authorized snapshot. */
  async assertAuthorizedTarget(
    tx: ArticleManagementClient,
    target: ArticleManagementTarget,
    accountOwnerId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.assertAuthorizedTargets(tx, [target], accountOwnerId, actorUserId);
  }
  /** Recheck every target before the first write; the transaction rolls back the whole batch on any later failure. */
  async assertAuthorizedTargets(
    tx: ArticleManagementClient,
    targets: readonly ArticleManagementTarget[],
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
    const currentTargets = await this.findTargets(
      targets.map((target) => target.id),
      accountOwnerId,
      tx,
    );
    if (!currentTargets) throw unavailable();
    targets.forEach((target, index) => {
      const current = currentTargets[index];
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
    });
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
  async reorder(
    items: readonly { target: ArticleManagementTarget; sortOrder: number }[],
    accountOwnerId: string,
    actorUserId: string,
  ): Promise<void> {
    await prisma.$transaction(
      async (tx) => {
        await this.assertAuthorizedTargets(
          tx,
          items.map((item) => item.target),
          accountOwnerId,
          actorUserId,
        );
        // Use a deterministic write order to avoid inconsistent lock ordering across overlapping batches.
        for (const item of [...items].sort((left, right) =>
          left.target.id < right.target.id ? -1 : left.target.id > right.target.id ? 1 : 0,
        ))
          await tx.article.update({
            where: { id: item.target.id, status: MANAGED_STATUS.ENABLED },
            data: { sortOrder: item.sortOrder },
          });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
