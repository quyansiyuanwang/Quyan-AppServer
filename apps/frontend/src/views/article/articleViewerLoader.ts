import type { ArticleDto, ArticleListItemDto } from '@/client/types.gen'

export interface ArticleViewerDataSource {
  listPublishedArticles(): Promise<ArticleListItemDto[]>
  listPublicArticles(): Promise<ArticleListItemDto[]>
  getArticle(id: string): Promise<ArticleDto>
  getPublicArticle(id: string): Promise<ArticleDto>
  getDefaultArticle(): Promise<ArticleDto | null>
  getPublicDefaultArticle(): Promise<ArticleDto | null>
}

export interface ArticleViewerLoadResult {
  authenticated: boolean
  articles: ArticleListItemDto[]
  selectedArticle: ArticleDto | null
}

export async function loadArticleViewerData(
  ensureAuthenticated: () => Promise<boolean>,
  source: ArticleViewerDataSource,
): Promise<ArticleViewerLoadResult> {
  const authenticated = await ensureAuthenticated()
  const [articles, defaultArticle] = await Promise.all([
    authenticated ? source.listPublishedArticles() : source.listPublicArticles(),
    (authenticated ? source.getDefaultArticle() : source.getPublicDefaultArticle()).catch(
      () => null,
    ),
  ])

  let selectedArticle = defaultArticle
  const firstArticle = articles[0]
  if (!selectedArticle && firstArticle) {
    selectedArticle = await (
      authenticated ? source.getArticle(firstArticle.id) : source.getPublicArticle(firstArticle.id)
    ).catch(() => null)
  }

  return {
    authenticated,
    articles,
    selectedArticle,
  }
}
