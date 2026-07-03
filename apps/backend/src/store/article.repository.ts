import { Article } from "@prisma/client";
import { prisma } from "@/config/database";
import type {
  ArticleCreateInput,
  ArticleQueryFilters,
  ArticleSortItem,
  ArticleStore,
  ArticleUpdateInput,
} from "./content/article.store";
import { MANAGED_STATUS } from "@/constant/status";

export class ArticleRepository implements ArticleStore {
  private static instance: ArticleRepository;

  public static getInstance(): ArticleRepository {
    if (!ArticleRepository.instance) ArticleRepository.instance = new ArticleRepository();

    return ArticleRepository.instance;
  }

  async create(data: ArticleCreateInput): Promise<Article> {
    return prisma.article.create({
      data,
    });
  }

  async findById(id: string): Promise<Article | null> {
    return prisma.article.findFirst({
      where: {
        id,
        status: MANAGED_STATUS.ENABLED,
      },
    });
  }

  async findBySlug(slug: string): Promise<Article | null> {
    return prisma.article.findFirst({
      where: {
        slug,
        status: MANAGED_STATUS.ENABLED,
      },
    });
  }

  async findAll(filters?: ArticleQueryFilters): Promise<Article[]> {
    return prisma.article.findMany({
      where: {
        status: MANAGED_STATUS.ENABLED,
        ...(filters?.publishStatus && { publishStatus: filters.publishStatus }),
        ...(filters?.category && { category: filters.category }),
        ...(filters?.authorId && { authorId: filters.authorId }),
        ...(filters?.isPublic !== undefined && { isPublic: filters.isPublic }),
      },
      orderBy: [{ sortOrder: "asc" }, { createTime: "desc" }],
    });
  }

  async findPublicIds(): Promise<string[]> {
    const articles = await prisma.article.findMany({
      where: {
        status: MANAGED_STATUS.ENABLED,
        publishStatus: "published",
        isPublic: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createTime: "desc" }],
      select: {
        id: true,
      },
    });

    return articles.map((article) => article.id);
  }

  async update(id: string, data: ArticleUpdateInput): Promise<Article> {
    return prisma.article.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<Article> {
    return prisma.article.update({
      where: { id },
      data: { status: MANAGED_STATUS.DELETED },
    });
  }

  async findDefault(): Promise<Article | null> {
    return prisma.article.findFirst({
      where: {
        isDefault: true,
        status: MANAGED_STATUS.ENABLED,
        publishStatus: "published",
      },
    });
  }

  async setDefault(id: string): Promise<void> {
    // Unset any existing default first
    await prisma.article.updateMany({
      where: { isDefault: true, status: MANAGED_STATUS.ENABLED },
      data: { isDefault: false },
    });
    await prisma.article.update({
      where: { id },
      data: { isDefault: true },
    });
  }

  async clearDefault(): Promise<void> {
    await prisma.article.updateMany({
      where: { isDefault: true, status: MANAGED_STATUS.ENABLED },
      data: { isDefault: false },
    });
  }

  async batchUpdateSortOrder(items: ArticleSortItem[]): Promise<void> {
    await Promise.all(
      items.map((item) =>
        prisma.article.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  }

  async incrementViewCount(id: string): Promise<void> {
    await prisma.article.update({
      where: { id },
      data: {
        viewCount: {
          increment: 1,
        },
      },
    });
  }
}
