import { useRequestStore } from '@/stores/request'
import { CustomCode } from '@/constant/custom-code'
import { toServiceError } from '@/utils/error-utils'
import { cacheObject } from '@/utils/common'
import { createArticleControllerApi } from '@/client/services/article-controller.gen'

const articleApi = cacheObject(() => createArticleControllerApi(useRequestStore().getAxios()))

interface CreateArticleRequest {
  title: string
  slug: string
  category?: string
  summary?: string
  content: string
  isPublic?: boolean
  requirePermission?: string
}

interface UpdateArticleRequest {
  title?: string
  slug?: string
  category?: string
  summary?: string
  content?: string
  isPublic?: boolean
  requirePermission?: string
}

export class ArticleService {
  private static instance: ArticleService | null = null

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new ArticleService()
    }
    return this.instance
  }

  async listArticles() {
    const result = await articleApi.listArticles({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async listPublishedArticles() {
    const result = await articleApi.listPublishedArticles({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async listPublicArticles() {
    const result = await articleApi.listPublicArticles({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async listPublicArticleIds() {
    const result = await articleApi.listPublicArticleIds({})
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data.ids
    }
    throw toServiceError(result)
  }

  async getArticle(id: string) {
    const result = await articleApi.getArticle({
      path: { id },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async getPublicArticle(id: string) {
    const result = await articleApi.getPublicArticle({
      path: { id },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async getArticleBySlug(slug: string) {
    const result = await articleApi.getArticleBySlug({
      path: { slug },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async getPublicArticleBySlug(slug: string) {
    const result = await articleApi.getPublicArticleBySlug({
      path: { slug },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async createArticle(data: CreateArticleRequest) {
    const result = await articleApi.createArticle({
      body: data,
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async updateArticle(id: string, data: UpdateArticleRequest) {
    const result = await articleApi.updateArticle({
      path: { id },
      body: data,
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async deleteArticle(id: string) {
    const result = await articleApi.deleteArticle({
      path: { id },
    })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async publishArticle(id: string) {
    const result = await articleApi.publishArticle({
      path: { id },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async unpublishArticle(id: string) {
    const result = await articleApi.unpublishArticle({
      path: { id },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async getDefaultArticle() {
    const result = await articleApi.getDefaultArticle({})
    if (result && result.code === CustomCode.OK) {
      return result.data ?? null
    }
    return null
  }

  async getPublicDefaultArticle() {
    const result = await articleApi.getPublicDefaultArticle({})
    if (result && result.code === CustomCode.OK) {
      return result.data ?? null
    }
    return null
  }

  async setDefaultArticle(id: string) {
    const result = await articleApi.setDefaultArticle({
      path: { id },
    })
    if (result && result.code === CustomCode.OK && result.data) {
      return result.data
    }
    throw toServiceError(result)
  }

  async clearDefaultArticle() {
    const result = await articleApi.clearDefaultArticle({})
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }

  async reorderArticles(items: Array<{ id: string; sortOrder: number }>) {
    const result = await articleApi.reorderArticles({
      body: { items },
    })
    if (result && result.code === CustomCode.OK) {
      return true
    }
    throw toServiceError(result)
  }
}

export const articleService = ArticleService.getInstance()
