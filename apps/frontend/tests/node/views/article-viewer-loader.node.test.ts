import { describe, expect, it, vi } from 'vitest'
import type { ArticleDto, ArticleListItemDto } from '@/client/types.gen'
import {
  loadArticleViewerData,
  type ArticleViewerDataSource,
} from '@/views/article/articleViewerLoader'

const article = (id: string) => ({ id, title: id }) as ArticleDto
const listItem = (id: string) => ({ id, title: id }) as ArticleListItemDto

const createSource = (overrides: Partial<ArticleViewerDataSource> = {}) =>
  ({
    listPublishedArticles: vi.fn().mockResolvedValue([listItem('published')]),
    listPublicArticles: vi.fn().mockResolvedValue([listItem('public')]),
    getArticle: vi.fn().mockResolvedValue(article('published-detail')),
    getPublicArticle: vi.fn().mockResolvedValue(article('public-detail')),
    getDefaultArticle: vi.fn().mockResolvedValue(article('published-default')),
    getPublicDefaultArticle: vi.fn().mockResolvedValue(article('public-default')),
    ...overrides,
  }) satisfies ArticleViewerDataSource

describe('article viewer loader', () => {
  it('waits for session restoration before choosing the public API', async () => {
    const source = createSource()
    const result = await loadArticleViewerData(async () => false, source)

    expect(source.listPublicArticles).toHaveBeenCalledTimes(1)
    expect(source.getPublicDefaultArticle).toHaveBeenCalledTimes(1)
    expect(source.listPublishedArticles).not.toHaveBeenCalled()
    expect(result.articles).toEqual([listItem('public')])
    expect(result.selectedArticle).toEqual(article('public-default'))
    expect(result.authenticated).toBe(false)
  })

  it('uses published APIs after a restored authenticated session', async () => {
    const source = createSource()
    const result = await loadArticleViewerData(async () => true, source)

    expect(source.listPublishedArticles).toHaveBeenCalledTimes(1)
    expect(source.getDefaultArticle).toHaveBeenCalledTimes(1)
    expect(source.listPublicArticles).not.toHaveBeenCalled()
    expect(result.articles).toEqual([listItem('published')])
    expect(result.selectedArticle).toEqual(article('published-default'))
    expect(result.authenticated).toBe(true)
  })

  it('falls back to the first visible article with the matching detail API', async () => {
    const source = createSource({
      listPublicArticles: vi.fn().mockResolvedValue([listItem('first-public')]),
      getPublicDefaultArticle: vi.fn().mockResolvedValue(null),
      getPublicArticle: vi.fn().mockResolvedValue(article('first-public-detail')),
    })

    const result = await loadArticleViewerData(async () => false, source)

    expect(source.getPublicArticle).toHaveBeenCalledWith('first-public')
    expect(source.getArticle).not.toHaveBeenCalled()
    expect(result.selectedArticle).toEqual(article('first-public-detail'))
  })
})
