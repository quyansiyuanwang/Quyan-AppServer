<template>
  <el-popover
    :visible="isOpen"
    trigger="click"
    placement="bottom-start"
    :width="640"
    :show-arrow="false"
    popper-class="global-navigation-search__popper"
    @update:visible="handlePopoverVisibility"
  >
    <template #reference>
      <el-input
        ref="searchInput"
        v-model="query"
        class="global-navigation-search"
        clearable
        :placeholder="i18ns.t('nav.globalSearchPlaceholder')"
        @input="open"
        @keydown.down.prevent="moveSelection(1)"
        @keydown.up.prevent="moveSelection(-1)"
        @keydown.enter.prevent="activateSelected"
        @keydown.esc.prevent="isOpen = false"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
        <template #suffix>
          <kbd>{{ shortcutHint }}</kbd>
        </template>
      </el-input>
    </template>

    <div class="global-navigation-search__results" role="listbox">
      <template v-for="group in groupedResults" :key="group.kind">
        <div class="global-navigation-search__group-label">{{ group.label }}</div>
        <button
          v-for="result in group.items"
          :key="result.id"
          type="button"
          class="global-navigation-search__result"
          :class="{ 'is-active': result === selectedResult }"
          role="option"
          :aria-selected="result === selectedResult"
          @mouseenter="selectedIndex = results.indexOf(result)"
          @click="activate(result)"
        >
          <el-icon><component :is="result.icon" /></el-icon>
          <span class="global-navigation-search__result-copy">
            <strong>{{ result.label }}</strong>
            <small v-if="result.siteLabel || result.pathLabel">
              {{ [result.siteLabel, result.pathLabel].filter(Boolean).join(' / ') }}
            </small>
          </span>
          <el-icon class="global-navigation-search__result-arrow"><ArrowRight /></el-icon>
        </button>
      </template>
      <el-empty
        v-if="!results.length"
        :description="i18ns.t('nav.globalSearchEmpty')"
        :image-size="72"
      />
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ArrowRight, Search } from '@element-plus/icons-vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import router from '@/router'
import { i18ns } from '@/locales'
import { normalizeDocsLocale, resolveDocsUrl } from '@/config/docs'
import { getRouteCatalogEntry } from '@/router/route-catalog'
import { assignDocument } from '@/service/navigationService'
import {
  useGlobalNavigationSearch,
  type GlobalNavigationSearchResult,
} from '@/composables/useGlobalNavigationSearch'

const isOpen = ref(false)
const searchInput = useTemplateRef<{ focus?: () => void }>('searchInput')
const { query, results, selectedIndex, moveSelection, reset } = useGlobalNavigationSearch()
const shortcutHint = computed(() => (navigator.userAgent.includes('Mac') ? '⌘ K' : 'Ctrl K'))
const selectedResult = computed(() => results.value[selectedIndex.value])
const groupedResults = computed(() => {
  const labels = {
    site: i18ns.t('nav.globalSearchSites'),
    page: i18ns.t('nav.globalSearchPages'),
    command: i18ns.t('nav.globalSearchCommands'),
  } as const

  return (Object.keys(labels) as Array<keyof typeof labels>)
    .map((kind) => ({
      kind,
      label: labels[kind],
      items: results.value.filter((item) => item.kind === kind),
    }))
    .filter((group) => group.items.length)
})

const open = () => {
  isOpen.value = true
}

const handlePopoverVisibility = (visible: boolean) => {
  isOpen.value = visible
  if (!visible) reset()
}

const openDocs = () => {
  const routeName =
    typeof router.currentRoute.value.name === 'string' ? router.currentRoute.value.name : undefined
  window.open(
    resolveDocsUrl(routeName, normalizeDocsLocale(i18ns.refer.value)),
    '_blank',
    'noopener,noreferrer',
  )
}

const activate = (result?: GlobalNavigationSearchResult) => {
  if (!result) return
  isOpen.value = false
  reset()

  if (result.kind === 'command') {
    openDocs()
    return
  }
  if (!result.profile) return

  if (result.kind === 'site') {
    const target = new URL(result.profile.defaultPath, result.profile.canonicalOrigin).toString()
    if (new URL(target).origin === window.location.origin) {
      void router.push(result.profile.defaultPath)
    } else {
      assignDocument(target)
    }
    return
  }

  const entry = result.route ? getRouteCatalogEntry(result.route) : undefined
  if (!entry || !result.route) return
  const target = new URL(entry.path, result.profile.canonicalOrigin).toString()
  if (new URL(target).origin === window.location.origin) {
    void router.push({ name: result.route } as any)
  } else {
    assignDocument(target)
  }
}

const activateSelected = () => activate(selectedResult.value)

const handleShortcut = (event: KeyboardEvent) => {
  if (
    event.defaultPrevented ||
    !(event.ctrlKey || event.metaKey) ||
    event.key.toLowerCase() !== 'k'
  )
    return
  event.preventDefault()
  open()
  void nextTick(() => searchInput.value?.focus?.())
}

onMounted(() => window.addEventListener('keydown', handleShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', handleShortcut))
</script>

<style scoped>
.global-navigation-search {
  flex: 1 1 280px;
  max-width: 520px;
  min-width: 160px;
  margin: 0 24px;
}

.global-navigation-search :deep(.el-input__wrapper) {
  background: var(--el-fill-color-light);
  box-shadow: 0 0 0 1px transparent inset;
  cursor: text;
}

.global-navigation-search :deep(.el-input__wrapper:hover),
.global-navigation-search :deep(.el-input__wrapper.is-focus) {
  background: var(--el-fill-color-blank);
  box-shadow: 0 0 0 1px var(--el-border-color) inset;
}

kbd {
  padding: 1px 5px;
  color: var(--el-text-color-secondary);
  font-family: inherit;
  font-size: 11px;
  white-space: nowrap;
  background: var(--el-fill-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 3px;
}

.global-navigation-search__results {
  display: grid;
  max-height: min(560px, calc(100vh - 110px));
  gap: 2px;
  overflow-y: auto;
}

.global-navigation-search__group-label {
  padding: 10px 8px 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 600;
}

.global-navigation-search__result {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 8px;
  color: var(--el-text-color-primary);
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.global-navigation-search__result:hover,
.global-navigation-search__result.is-active {
  background: var(--el-fill-color-light);
}

.global-navigation-search__result-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.global-navigation-search__result-copy strong,
.global-navigation-search__result-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.global-navigation-search__result-copy small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.global-navigation-search__result-arrow {
  margin-left: auto;
  color: var(--el-text-color-secondary);
}

@media screen and (max-width: 768px) {
  .global-navigation-search {
    flex: 0 0 34px;
    min-width: 34px;
    margin: 0 4px 0 auto;
  }

  .global-navigation-search :deep(.el-input__wrapper) {
    justify-content: center;
    padding: 0;
    background: transparent;
  }

  .global-navigation-search :deep(.el-input__inner),
  .global-navigation-search :deep(.el-input__suffix) {
    display: none;
  }
}
</style>

<style>
.global-navigation-search__popper.el-popover {
  width: min(640px, calc(100vw - 32px)) !important;
  padding: 8px;
  border-radius: 6px;
}
</style>
