import { ArticleRepository } from "@/store/content/article.repository";
import { UserRepository } from "@/store/users/user.repository";
import type { ArticleStore } from "@/store/content/article.store";
import type { UserStore } from "@/store/users/user.store";
import { PermissionService } from "@/services/users/permission.service";
import BusinessLogService from "@/services/system/businesslog.service";
import {
  CreateArticleDto,
  UpdateArticleDto,
  ArticleDto,
  ArticleListItemDto,
  PublicArticleIdListDto,
  ReorderArticleItem,
} from "@/api/dto/article/article.dto";
import { BadRequestError, NotFoundError, ForbiddenError } from "@/util/errors";
import { OperationType, OperationCategory } from "@/constant/operation-type";
import { Permission } from "@/constant/permission";
import { extractClientIp } from "@/util/ip-extractor";
import type { Request } from "express";

export class ArticleService {
  private static instance: ArticleService;

  private constructor(
    private readonly repository: ArticleStore = ArticleRepository.getInstance(),
    private readonly userRepository: UserStore = UserRepository.getInstance(),
    private readonly permissionService: PermissionService = PermissionService.getInstance(),
    private readonly businessLogService: BusinessLogService = BusinessLogService.getInstance(),
  ) {}

  public static getInstance(): ArticleService {
    if (!ArticleService.instance) ArticleService.instance = new ArticleService();

    return ArticleService.instance;
  }

  private getClientIP(req?: Request): string {
    if (!req) return "unknown";
    return extractClientIp(req);
  }

  async createArticle(dto: CreateArticleDto, authorId: string, request: Request): Promise<ArticleDto> {
    const existing = await this.repository.findBySlug(dto.slug);
    if (existing) throw new BadRequestError("Slug already exists");

    this.validatePublicAccess(dto.isPublic ?? false, dto.requirePermission);

    const article = await this.repository.create({
      ...dto,
      authorId,
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.ARTICLE_CREATE,
      operationCategory: OperationCategory.ARTICLE,
      actorUserId: authorId,
      targetResourceId: article.id,
      targetResourceType: "Article",
      description: `Created article: ${article.title}`,
      metadata: { slug: article.slug },
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });

    return this.toArticleDto(article);
  }

  async updateArticle(id: string, dto: UpdateArticleDto, userId: string, request: Request): Promise<ArticleDto> {
    const article = await this.repository.findById(id);
    if (!article) throw new NotFoundError("Article not found");

    if (article.authorId !== userId) throw new ForbiddenError("You can only update your own articles");

    if (dto.slug && dto.slug !== article.slug) {
      const existing = await this.repository.findBySlug(dto.slug);
      if (existing) throw new BadRequestError("Slug already exists");
    }

    this.validatePublicAccess(
      dto.isPublic ?? article.isPublic,
      dto.requirePermission ?? article.requirePermission ?? undefined,
    );

    const updated = await this.repository.update(id, dto);

    await this.businessLogService.logOperation({
      operationType: OperationType.ARTICLE_UPDATE,
      operationCategory: OperationCategory.ARTICLE,
      actorUserId: userId,
      targetResourceId: id,
      targetResourceType: "Article",
      description: `Updated article: ${updated.title}`,
      changes: dto,
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });

    return this.toArticleDto(updated);
  }

  async deleteArticle(id: string, userId: string, request: Request): Promise<void> {
    const article = await this.repository.findById(id);
    if (!article) throw new NotFoundError("Article not found");

    if (article.authorId !== userId) throw new ForbiddenError("You can only delete your own articles");

    await this.repository.delete(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.ARTICLE_DELETE,
      operationCategory: OperationCategory.ARTICLE,
      actorUserId: userId,
      targetResourceId: id,
      targetResourceType: "Article",
      description: `Deleted article: ${article.title}`,
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });
  }

  async publishArticle(id: string, userId: string, request: Request): Promise<ArticleDto> {
    const article = await this.repository.findById(id);
    if (!article) throw new NotFoundError("Article not found");

    if (article.publishStatus === "published") throw new BadRequestError("Article is already published");

    const updated = await this.repository.update(id, {
      publishStatus: "published",
      publishedAt: new Date(),
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.ARTICLE_PUBLISH,
      operationCategory: OperationCategory.ARTICLE,
      actorUserId: userId,
      targetResourceId: id,
      targetResourceType: "Article",
      description: `Published article: ${updated.title}`,
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });

    return this.toArticleDto(updated);
  }

  async unpublishArticle(id: string, userId: string, request: Request): Promise<ArticleDto> {
    const article = await this.repository.findById(id);
    if (!article) throw new NotFoundError("Article not found");

    if (article.publishStatus === "draft") throw new BadRequestError("Article is already a draft");

    const updated = await this.repository.update(id, {
      publishStatus: "draft",
    });

    await this.businessLogService.logOperation({
      operationType: OperationType.ARTICLE_UNPUBLISH,
      operationCategory: OperationCategory.ARTICLE,
      actorUserId: userId,
      targetResourceId: id,
      targetResourceType: "Article",
      description: `Unpublished article: ${updated.title}`,
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });

    return this.toArticleDto(updated);
  }

  async getArticle(id: string, userId: string): Promise<ArticleDto> {
    const article = await this.repository.findById(id);
    if (!article) throw new NotFoundError("Article not found");

    // Check permissions
    await this.checkArticleAccess(article, userId);

    // Increment view count (fire and forget)
    this.repository.incrementViewCount(id).catch(() => {
      // Ignore errors
    });

    return this.toArticleDto(article);
  }

  async getPublicArticle(id: string): Promise<ArticleDto> {
    const article = await this.repository.findById(id);
    if (!article) throw new NotFoundError("Article not found");

    await this.checkPublicArticleAccess(article);

    this.repository.incrementViewCount(id).catch(() => {
      // Ignore errors
    });

    return this.toArticleDto(article);
  }

  async getArticleBySlug(slug: string, userId: string): Promise<ArticleDto> {
    const article = await this.repository.findBySlug(slug);
    if (!article) throw new NotFoundError("Article not found");

    // Check permissions
    await this.checkArticleAccess(article, userId);

    // Increment view count (fire and forget)
    this.repository.incrementViewCount(article.id).catch(() => {
      // Ignore errors
    });

    return this.toArticleDto(article);
  }

  async getPublicArticleBySlug(slug: string): Promise<ArticleDto> {
    const article = await this.repository.findBySlug(slug);
    if (!article) throw new NotFoundError("Article not found");

    await this.checkPublicArticleAccess(article);

    this.repository.incrementViewCount(article.id).catch(() => {
      // Ignore errors
    });

    return this.toArticleDto(article);
  }

  async listArticles(
    userId: string,
    filters?: {
      category?: string;
      authorId?: string;
    },
  ): Promise<ArticleListItemDto[]> {
    // Admin users can see all articles (draft + published)
    const articles = await this.repository.findAll(filters);

    // Filter by permissions
    const accessible = await Promise.all(
      articles.map(async (article) => {
        try {
          await this.checkArticleAccess(article, userId);
          return article;
        } catch {
          return null;
        }
      }),
    );

    return Promise.all(accessible.filter((a) => a !== null).map((a) => this.toArticleListItemDto(a!)));
  }

  async listPublishedArticles(userId: string): Promise<ArticleListItemDto[]> {
    // Only show published articles
    const articles = await this.repository.findAll({
      publishStatus: "published",
    });

    // Filter by permissions
    const accessible = await Promise.all(
      articles.map(async (article) => {
        try {
          await this.checkArticleAccess(article, userId);
          return article;
        } catch {
          return null;
        }
      }),
    );

    return Promise.all(accessible.filter((a) => a !== null).map((a) => this.toArticleListItemDto(a!)));
  }

  async listPublicArticles(): Promise<ArticleListItemDto[]> {
    const articles = await this.repository.findAll({
      publishStatus: "published",
      isPublic: true,
    });

    return Promise.all(articles.map((article) => this.toArticleListItemDto(article)));
  }

  async listPublicArticleIds(): Promise<PublicArticleIdListDto> {
    const ids = await this.repository.findPublicIds();

    return { ids };
  }

  async getPublicDefaultArticle(): Promise<ArticleDto | null> {
    const article = await this.repository.findDefault();
    if (!article || !article.isPublic) return null;

    this.repository.incrementViewCount(article.id).catch(() => {});
    return this.toArticleDto(article);
  }

  private validatePublicAccess(isPublic: boolean, requirePermission?: string): void {
    if (isPublic && requirePermission?.trim()) throw new BadRequestError("Public articles cannot require permissions");
  }

  private async checkArticleAccess(article: any, userId: string): Promise<void> {
    // If article is draft, only author can access
    if (article.publishStatus === "draft" && article.authorId !== userId)
      throw new ForbiddenError("You cannot access draft articles");

    if (article.isPublic) return;

    // Check if article requires specific permission
    if (article.requirePermission) {
      const hasPermission = await this.permissionService.hasPermission(userId, article.requirePermission as Permission);
      if (!hasPermission) throw new ForbiddenError("You do not have permission to access this article");
    }
  }

  private async checkPublicArticleAccess(article: any): Promise<void> {
    if (article.publishStatus !== "published") throw new ForbiddenError("You cannot access draft articles");
    if (!article.isPublic) throw new ForbiddenError("This article is not public");
  }

  private async toArticleDto(article: any): Promise<ArticleDto> {
    const author = await this.userRepository.findById(article.authorId);

    return {
      id: article.id,
      title: article.title,
      slug: article.slug,
      category: article.category,
      summary: article.summary,
      content: article.content,
      publishStatus: article.publishStatus,
      publishedAt: article.publishedAt?.toISOString(),
      authorId: article.authorId,
      authorName: author?.name || author?.username,
      isPublic: article.isPublic ?? false,
      requirePermission: article.requirePermission,
      viewCount: article.viewCount,
      isDefault: article.isDefault ?? false,
      sortOrder: article.sortOrder ?? 0,
      createTime: article.createTime.toISOString(),
      updateTime: article.updateTime.toISOString(),
    };
  }

  private async toArticleListItemDto(article: any): Promise<ArticleListItemDto> {
    const author = await this.userRepository.findById(article.authorId);

    return {
      id: article.id,
      title: article.title,
      slug: article.slug,
      category: article.category,
      summary: article.summary,
      publishStatus: article.publishStatus,
      publishedAt: article.publishedAt?.toISOString(),
      authorName: author?.name || author?.username,
      isPublic: article.isPublic ?? false,
      viewCount: article.viewCount,
      isDefault: article.isDefault ?? false,
      sortOrder: article.sortOrder ?? 0,
      createTime: article.createTime.toISOString(),
      updateTime: article.updateTime.toISOString(),
    };
  }

  async getDefaultArticle(userId: string): Promise<ArticleDto | null> {
    const article = await this.repository.findDefault();
    if (!article) return null;

    try {
      await this.checkArticleAccess(article, userId);
    } catch {
      return null;
    }

    this.repository.incrementViewCount(article.id).catch(() => {});
    return this.toArticleDto(article);
  }

  async setDefaultArticle(id: string, userId: string, request: Request): Promise<ArticleDto> {
    const article = await this.repository.findById(id);
    if (!article) throw new NotFoundError("Article not found");
    if (article.publishStatus !== "published")
      throw new BadRequestError("Only published articles can be set as default");

    await this.repository.setDefault(id);

    await this.businessLogService.logOperation({
      operationType: OperationType.ARTICLE_UPDATE,
      operationCategory: OperationCategory.ARTICLE,
      actorUserId: userId,
      targetResourceId: id,
      targetResourceType: "Article",
      description: `Set article as default: ${article.title}`,
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });

    const updated = await this.repository.findById(id);
    return this.toArticleDto(updated!);
  }

  async clearDefaultArticle(userId: string, request: Request): Promise<void> {
    await this.repository.clearDefault();

    await this.businessLogService.logOperation({
      operationType: OperationType.ARTICLE_UPDATE,
      operationCategory: OperationCategory.ARTICLE,
      actorUserId: userId,
      targetResourceId: "default",
      targetResourceType: "Article",
      description: "Cleared default article",
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });
  }

  async reorderArticles(items: ReorderArticleItem[], userId: string, request: Request): Promise<void> {
    await this.repository.batchUpdateSortOrder(items);

    await this.businessLogService.logOperation({
      operationType: OperationType.ARTICLE_UPDATE,
      operationCategory: OperationCategory.ARTICLE,
      actorUserId: userId,
      targetResourceId: "batch",
      targetResourceType: "Article",
      description: `Reordered ${items.length} articles`,
      success: true,
      requestId: request.headers["x-request-id"] as string | undefined,
      ipAddress: this.getClientIP(request),
      userAgent: request.headers["user-agent"],
    });
  }
}
