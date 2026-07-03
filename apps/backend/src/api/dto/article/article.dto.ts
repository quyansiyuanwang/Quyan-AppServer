export interface CreateArticleDto {
  /** 标题 */
  title: string;
  /** Slug */
  slug: string;
  /** 分类 */
  category?: string;
  /** 摘要 */
  summary?: string;
  /** 正文 */
  content: string;
  /** 是否公开，无需登录和 token */
  isPublic?: boolean;
  /** 访问权限 */
  requirePermission?: string;
}

export interface UpdateArticleDto {
  /** 标题 */
  title?: string;
  /** Slug */
  slug?: string;
  /** 分类 */
  category?: string;
  /** 摘要 */
  summary?: string;
  content?: string;
  /** 是否公开，无需登录和 token */
  isPublic?: boolean;
  /** 访问权限 */
  requirePermission?: string;
}

export interface ArticleDto {
  id: string;
  title: string;
  slug: string;
  category?: string;
  summary?: string;
  content: string;
  publishStatus: string;
  publishedAt?: string;
  authorId: string;
  authorName?: string;
  isPublic: boolean;
  requirePermission?: string;
  viewCount: number;
  isDefault: boolean;
  sortOrder: number;
  createTime: string;
  updateTime: string;
}

export interface ArticleListItemDto {
  id: string;
  title: string;
  slug: string;
  category?: string;
  summary?: string;
  publishStatus: string;
  publishedAt?: string;
  authorName?: string;
  isPublic: boolean;
  viewCount: number;
  isDefault: boolean;
  sortOrder: number;
  createTime: string;
  updateTime: string;
}

export interface PublicArticleIdListDto {
  ids: string[];
}

export interface ReorderArticleItem {
  id: string;
  /** 排序值 */
  sortOrder: number;
}

export interface ReorderArticlesDto {
  items: ReorderArticleItem[];
}
