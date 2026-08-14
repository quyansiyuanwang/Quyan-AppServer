<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="article-viewer">
      <div class="viewer-layout">
        <!-- Main Content -->
        <div class="viewer-main">
          <template v-if="selectedArticle">
            <el-card shadow="never" class="article-card">
              <div class="article-header">
                <h1 class="article-title">{{ selectedArticle.title }}</h1>
                <div class="article-meta">
                  <template v-if="selectedArticle.category">
                    <el-tag
                      v-for="cat in selectedArticle.category.split(',')"
                      :key="cat"
                      size="small"
                      style="margin-right: 4px"
                      >{{ cat.trim() }}</el-tag
                    >
                  </template>
                  <span class="meta-item">
                    <el-icon><User /></el-icon>
                    {{ selectedArticle.authorName || '—' }}
                  </span>
                  <span class="meta-item">
                    <el-icon><Calendar /></el-icon>
                    {{ formatDate(selectedArticle.publishedAt || selectedArticle.createTime) }}
                  </span>
                  <span class="meta-item">
                    <el-icon><View /></el-icon>
                    {{ selectedArticle.viewCount }}
                  </span>
                </div>
              </div>
              <el-divider />
              <MarkdownRenderer :content="selectedArticle.content" />
            </el-card>
          </template>
          <template v-else>
            <el-card shadow="never" class="empty-card">
              <el-empty :description="i18ns.t('article.selectArticle')" />
            </el-card>
          </template>
        </div>

        <!-- Right Sidebar -->
        <div class="viewer-sidebar">
          <!-- Article List -->
          <el-card shadow="never" class="sidebar-card">
            <template #header>
              <div class="sidebar-header">
                <span>{{ i18ns.t('article.articleList') }}</span>
                <el-input
                  v-model="searchQuery"
                  :placeholder="i18ns.t('article.search')"
                  size="small"
                  clearable
                  :prefix-icon="Search"
                  class="search-input"
                />
              </div>
            </template>
            <div class="article-list" v-loading="loading">
              <div
                v-for="item in filteredArticles"
                :key="item.id"
                :class="['article-list-item', { active: selectedArticle?.id === item.id }]"
                @click="selectArticle(item)"
              >
                <div class="list-item-title">{{ item.title }}</div>
                <div class="list-item-meta">
                  <template v-if="item.category">
                    <el-tag
                      v-for="cat in item.category.split(',')"
                      :key="cat"
                      size="small"
                      type="info"
                      style="margin-right: 2px"
                      >{{ cat.trim() }}</el-tag
                    >
                  </template>
                  <span class="list-item-date">{{ formatShortDate(item.createTime) }}</span>
                </div>
              </div>
              <div v-if="filteredArticles.length === 0 && !loading" class="no-articles">
                {{ i18ns.t('article.noArticles') }}
              </div>
            </div>
          </el-card>

          <!-- TOC -->
          <el-card v-if="selectedArticle" shadow="never" class="sidebar-card toc-card">
            <ArticleTOC :content="selectedArticle.content" :active-id="activeTocId" />
          </el-card>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="mobile-page mobile-adapter">
    <div class="article-viewer">
      <div class="viewer-layout">
        <!-- Main Content -->
        <div class="viewer-main">
          <template v-if="selectedArticle">
            <el-card shadow="never" class="article-card">
              <div class="article-header">
                <h1 class="article-title">{{ selectedArticle.title }}</h1>
                <div class="article-meta">
                  <template v-if="selectedArticle.category">
                    <el-tag
                      v-for="cat in selectedArticle.category.split(',')"
                      :key="cat"
                      size="small"
                      style="margin-right: 4px"
                      >{{ cat.trim() }}</el-tag
                    >
                  </template>
                  <span class="meta-item">
                    <el-icon><User /></el-icon>
                    {{ selectedArticle.authorName || '—' }}
                  </span>
                  <span class="meta-item">
                    <el-icon><Calendar /></el-icon>
                    {{ formatDate(selectedArticle.publishedAt || selectedArticle.createTime) }}
                  </span>
                  <span class="meta-item">
                    <el-icon><View /></el-icon>
                    {{ selectedArticle.viewCount }}
                  </span>
                </div>
              </div>
              <el-divider />
              <MarkdownRenderer :content="selectedArticle.content" />
            </el-card>
          </template>
          <template v-else>
            <el-card shadow="never" class="empty-card">
              <el-empty :description="i18ns.t('article.selectArticle')" />
            </el-card>
          </template>
        </div>

        <!-- Right Sidebar -->
        <div class="viewer-sidebar">
          <!-- Article List -->
          <el-card shadow="never" class="sidebar-card">
            <template #header>
              <div class="sidebar-header">
                <span>{{ i18ns.t('article.articleList') }}</span>
                <el-input
                  v-model="searchQuery"
                  :placeholder="i18ns.t('article.search')"
                  size="small"
                  clearable
                  :prefix-icon="Search"
                  class="search-input"
                />
              </div>
            </template>
            <div class="article-list" v-loading="loading">
              <div
                v-for="item in filteredArticles"
                :key="item.id"
                :class="['article-list-item', { active: selectedArticle?.id === item.id }]"
                @click="selectArticle(item)"
              >
                <div class="list-item-title">{{ item.title }}</div>
                <div class="list-item-meta">
                  <template v-if="item.category">
                    <el-tag
                      v-for="cat in item.category.split(',')"
                      :key="cat"
                      size="small"
                      type="info"
                      style="margin-right: 2px"
                      >{{ cat.trim() }}</el-tag
                    >
                  </template>
                  <span class="list-item-date">{{ formatShortDate(item.createTime) }}</span>
                </div>
              </div>
              <div v-if="filteredArticles.length === 0 && !loading" class="no-articles">
                {{ i18ns.t('article.noArticles') }}
              </div>
            </div>
          </el-card>

          <!-- TOC -->
          <el-card v-if="selectedArticle" shadow="never" class="sidebar-card toc-card">
            <ArticleTOC :content="selectedArticle.content" :active-id="activeTocId" />
          </el-card>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { User, Calendar, View, Search } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { articleService } from '@/service/articleService'
import { useSessionStore } from '@/stores/sessionStore'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import ArticleTOC from '@/components/common/ArticleTOC.vue'
import type { ArticleDto, ArticleListItemDto } from '@/client/types.gen'

const loading = ref(false)
const articles = ref<ArticleListItemDto[]>([])
const selectedArticle = ref<ArticleDto | null>(null)
const searchQuery = ref('')
const activeTocId = ref('')

const sessionStore = useSessionStore()
const isAuthenticated = computed(() => sessionStore.isAuthenticated)

const filteredArticles = computed(() => {
  if (!searchQuery.value) return articles.value
  const q = searchQuery.value.toLowerCase()
  return articles.value.filter(
    (a) =>
      a.title.toLowerCase().includes(q) ||
      (a.category && a.category.toLowerCase().includes(q)) ||
      (a.summary && a.summary.toLowerCase().includes(q)),
  )
})

function formatDate(dateStr: string) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString()
}

function formatShortDate(dateStr: string) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString()
}

async function loadArticles() {
  loading.value = true
  try {
    articles.value = isAuthenticated.value
      ? await articleService.listPublishedArticles()
      : await articleService.listPublicArticles()
  } catch (e: any) {
    ElMessage.error(e.message || 'Failed to load articles')
  } finally {
    loading.value = false
  }
}

async function selectArticle(item: ArticleListItemDto) {
  if (selectedArticle.value?.id === item.id) return
  try {
    selectedArticle.value = isAuthenticated.value
      ? await articleService.getArticle(item.id)
      : await articleService.getPublicArticle(item.id)
  } catch (e: any) {
    ElMessage.error(e.message || 'Failed to load article')
  }
}

onMounted(async () => {
  await loadArticles()
  // Try to open the designated default article first, fallback to first in list
  const defaultArticle = await (
    isAuthenticated.value
      ? articleService.getDefaultArticle()
      : articleService.getPublicDefaultArticle()
  ).catch(() => null)
  if (defaultArticle) {
    selectedArticle.value = defaultArticle
  } else if (articles.value.length > 0) {
    await selectArticle(articles.value[0]!)
  }
})

const { isDesktop } = usePageDevice()

if (!isDesktop.value) {
  useMobileTableCardLabels('.mobile-adapter')
}
</script>

<style scoped>
.article-viewer {
  width: 100%;
  min-width: 0;
}

.viewer-layout {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  align-items: flex-start;
}

.viewer-main {
  flex: 1;
  min-width: 0;
}

.viewer-sidebar {
  width: min(300px, 100%);
  flex-shrink: 0;
  position: sticky;
  top: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: calc(100vh - 60px);
}

.article-card {
  margin-bottom: 20px;
}

.article-header {
  margin-bottom: 8px;
}

.article-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  margin: 0 0 12px 0;
  line-height: 1.4;
}

.article-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.empty-card {
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sidebar-card {
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-header > span {
  font-size: 14px;
  font-weight: 600;
}

.search-input {
  width: 100%;
}

.article-list {
  max-height: 400px;
  overflow-y: auto;
}

.article-list-item {
  padding: 10px 12px;
  cursor: pointer;
  border-radius: 6px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
  margin-bottom: 4px;
}

.article-list-item:hover {
  background-color: var(--el-fill-color-light);
}

.article-list-item.active {
  background-color: var(--el-color-primary-light-9);
  border-left: 3px solid var(--el-color-primary);
}

.list-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.list-item-date {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.no-articles {
  text-align: center;
  padding: 24px;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
}

.toc-card {
  overflow: hidden;
}

@media (max-width: 768px) {
  .viewer-layout {
    flex-direction: column-reverse;
  }

  .viewer-sidebar {
    width: 100%;
    position: static;
    max-height: none;
  }

  .article-list {
    max-height: 200px;
  }
}
</style>

<style scoped>
.mobile-adapter {
  padding: 8px 6px 16px;
  overflow-x: hidden;
}

.mobile-adapter :deep(.hide-on-mobile),
.mobile-adapter :deep(.el-table__header-wrapper),
.mobile-adapter :deep(.el-scrollbar__bar.is-horizontal),
.mobile-adapter :deep(.el-table__body colgroup),
.mobile-adapter :deep(.el-table__header colgroup) {
  display: none !important;
}

.mobile-adapter :deep(.el-form--inline) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.mobile-adapter :deep(.el-form-item) {
  margin-right: 0;
  margin-bottom: 10px;
}

.mobile-adapter :deep(.el-form-item__label) {
  float: none;
  display: block;
  text-align: left;
  padding: 0 0 6px;
}

.mobile-adapter :deep(.el-form-item__content) {
  margin-left: 0 !important;
}

.mobile-adapter :deep(.el-input),
.mobile-adapter :deep(.el-select),
.mobile-adapter :deep(.el-date-editor),
.mobile-adapter :deep(.el-input-number),
.mobile-adapter :deep(.el-textarea),
.mobile-adapter :deep(.el-button) {
  width: 100%;
}

.mobile-adapter :deep(.el-table__inner-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__wrap),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__view) {
  overflow-x: hidden !important;
}

.mobile-adapter :deep(.el-table__body-wrapper) {
  overflow-y: visible !important;
  padding: 4px 0 10px;
}

.mobile-adapter :deep(.el-table__body tbody) {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mobile-adapter :deep(.el-table__body tr) {
  display: block;
  width: 100% !important;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
}

.mobile-adapter :deep(.el-table__body td) {
  display: block;
  border: none !important;
  padding: 5px 0;
}

.mobile-adapter :deep(.el-table__body td::before) {
  content: attr(data-label);
  display: block;
  margin-bottom: 2px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
}

.mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}

.mobile-adapter :deep(.el-drawer) {
  max-height: 92vh;
}

.mobile-adapter :deep(.el-pagination) {
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
