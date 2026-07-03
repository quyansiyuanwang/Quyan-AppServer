import type { Article } from "@prisma/client";

export interface ArticleCreateInput {
  title: string;
  slug: string;
  category?: string;
  summary?: string;
  content: string;
  authorId: string;
  isPublic?: boolean;
  requirePermission?: string;
}

export interface ArticleUpdateInput {
  title?: string;
  slug?: string;
  category?: string;
  summary?: string;
  content?: string;
  isPublic?: boolean;
  requirePermission?: string;
  publishStatus?: string;
  publishedAt?: Date | null;
}

export interface ArticleQueryFilters {
  publishStatus?: string;
  category?: string;
  authorId?: string;
  isPublic?: boolean;
}

export interface ArticleSortItem {
  id: string;
  sortOrder: number;
}

export interface ArticleStore {
  create(data: ArticleCreateInput): Promise<Article>;
  findById(id: string): Promise<Article | null>;
  findBySlug(slug: string): Promise<Article | null>;
  findAll(filters?: ArticleQueryFilters): Promise<Article[]>;
  findPublicIds(): Promise<string[]>;
  update(id: string, data: ArticleUpdateInput): Promise<Article>;
  delete(id: string): Promise<Article>;
  findDefault(): Promise<Article | null>;
  setDefault(id: string): Promise<void>;
  clearDefault(): Promise<void>;
  batchUpdateSortOrder(items: ArticleSortItem[]): Promise<void>;
  incrementViewCount(id: string): Promise<void>;
}
