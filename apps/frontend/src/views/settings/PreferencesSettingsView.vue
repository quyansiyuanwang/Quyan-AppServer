<template>
  <div class="settings-view-root">
    <div v-if="isDesktop" class="desktop-page">
      <div class="settings-container">
        <div class="page-header">
          <h1 class="page-title">{{ i18ns.t('nav.preferences') }}</h1>
        </div>

        <el-card class="section-card page-card">
          <h3>{{ i18ns.t('SettingsView.themeLanguageTitle') }}</h3>
          <div class="prefs-actions">
            <el-button @click="toggleDark">
              <el-icon><component :is="iconRef" /></el-icon>
              <span>{{ i18ns.t('SettingsView.themeLabel') }}</span>
            </el-button>
            <LanguageSwitcher />
          </div>
        </el-card>

        <el-card class="section-card page-card">
          <h3>{{ i18ns.t('SettingsView.clearCacheTitle') }}</h3>
          <p class="section-desc">{{ i18ns.t('SettingsView.clearCacheDesc') }}</p>
          <div class="prefs-actions">
            <el-button type="warning" @click="handleClearLocalStorage">
              {{ i18ns.t('SettingsView.clearLocalStorageButton') }}
            </el-button>
            <el-button type="warning" @click="handleClearSessionDB">
              {{ i18ns.t('SettingsView.clearSessionDBButton') }}
            </el-button>
            <el-button type="danger" @click="handleClearAllCache">
              {{ i18ns.t('SettingsView.clearAllButton') }}
            </el-button>
          </div>
        </el-card>
      </div>
    </div>
    <div v-else class="mobile-page">
      <div class="settings-mobile">
        <h1 class="page-title">{{ i18ns.t('nav.preferences') }}</h1>

        <el-card class="section-card mobile-card">
          <h3>{{ i18ns.t('SettingsView.themeLanguageTitle') }}</h3>
          <div class="stack">
            <el-button class="w-full" @click="toggleDark">
              <el-icon><component :is="iconRef" /></el-icon>
              <span>{{ i18ns.t('SettingsView.themeLabel') }}</span>
            </el-button>
            <div class="w-full lang-wrap">
              <LanguageSwitcher />
            </div>
          </div>
        </el-card>

        <el-card class="section-card mobile-card">
          <h3>{{ i18ns.t('SettingsView.clearCacheTitle') }}</h3>
          <p class="section-desc">{{ i18ns.t('SettingsView.clearCacheDesc') }}</p>
          <div class="stack">
            <el-button class="w-full" type="warning" @click="handleClearLocalStorage">
              {{ i18ns.t('SettingsView.clearLocalStorageButton') }}
            </el-button>
            <el-button class="w-full" type="warning" @click="handleClearSessionDB">
              {{ i18ns.t('SettingsView.clearSessionDBButton') }}
            </el-button>
            <el-button class="w-full" type="danger" @click="handleClearAllCache">
              {{ i18ns.t('SettingsView.clearAllButton') }}
            </el-button>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { computed } from 'vue'
import { i18ns } from '@/locales'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import { Sunny, Moon } from '@element-plus/icons-vue'
import { useThemeToggleStore } from '@/stores/themeToggleStore'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sessionDB, STORE_NAMES } from '@/utils/sessionDB'

const themeToggleStore = useThemeToggleStore()
const isDark = themeToggleStore.useIsDark()
const toggleDark = () => themeToggleStore.toggleTheme()
const iconRef = computed(() => (isDark.value ? Sunny : Moon))

const formatStorageSize = (size: number) => {
  const sizeInKB = (size / 1024).toFixed(2)
  const sizeInMB = (size / 1024 / 1024).toFixed(2)
  return size > 1024 * 1024 ? `${sizeInMB} MB` : `${sizeInKB} KB`
}

const getLocalStorageSize = () => {
  let localStorageSize = 0

  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key) continue

    const value = localStorage.getItem(key) ?? ''
    localStorageSize += key.length + value.length
  }

  return localStorageSize * 2
}

const getSessionDBSize = async () => {
  try {
    let dbSize = 0

    for (const storeName of Object.values(STORE_NAMES)) {
      const records = await sessionDB.getAll<unknown>(storeName)
      dbSize += new Blob([JSON.stringify(records)]).size
    }

    return dbSize
  } catch {
    return 0
  }
}

const reloadAfterCacheClear = () => {
  setTimeout(() => {
    window.location.reload()
  }, 1500)
}

const handleClearLocalStorage = async () => {
  try {
    const localStorageSize = getLocalStorageSize()
    const displaySize = formatStorageSize(localStorageSize)

    await ElMessageBox.confirm(
      `${i18ns.t('SettingsView.clearLocalStorageWarning')} (${displaySize})`,
      i18ns.t('SettingsView.clearLocalStorageTitle'),
      { type: 'warning', confirmButtonClass: 'el-button--danger' },
    )

    localStorage.clear()
    ElMessage.success(`${i18ns.t('SettingsView.clearLocalStorageSuccess')} (${displaySize})`)
    reloadAfterCacheClear()
  } catch {
    // user cancelled
  }
}

const handleClearSessionDB = async () => {
  try {
    const dbSize = await getSessionDBSize()
    const displaySize = formatStorageSize(dbSize)

    await ElMessageBox.confirm(
      `${i18ns.t('SettingsView.clearSessionDBWarning')} (${displaySize})`,
      i18ns.t('SettingsView.clearSessionDBTitle'),
      { type: 'warning' },
    )

    await sessionDB.deleteDB()
    ElMessage.success(`${i18ns.t('SettingsView.clearSessionDBSuccess')} (${displaySize})`)
  } catch {
    // user cancelled
  }
}

const handleClearAllCache = async () => {
  try {
    const localStorageSize = getLocalStorageSize()
    const dbSize = await getSessionDBSize()
    const totalSize = localStorageSize + dbSize
    const displaySize = formatStorageSize(totalSize)

    await ElMessageBox.confirm(
      `${i18ns.t('SettingsView.clearAllWarning')} (${displaySize})`,
      i18ns.t('SettingsView.clearAllTitle'),
      { type: 'warning', confirmButtonClass: 'el-button--danger' },
    )

    localStorage.clear()
    await sessionDB.deleteDB()
    ElMessage.success(`${i18ns.t('SettingsView.clearAllSuccess')} (${displaySize})`)
    reloadAfterCacheClear()
  } catch {
    // user cancelled
  }
}

const { isDesktop } = usePageDevice()
</script>

<style scoped lang="scss">
.settings-container {
  max-width: 61.8vw;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-card {
  margin-top: 16px;
}

h3 {
  margin: 0 0 20px;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-desc {
  margin-bottom: 16px;
  color: var(--el-text-color-secondary);
}

.w-full {
  width: 100%;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.prefs-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.prefs-actions .el-button,
.prefs-actions :deep(.el-dropdown) {
  min-width: 140px;
}

@media (max-width: 768px) {
  .settings-container {
    max-width: 100%;
    padding: 0 4px;
  }
}
</style>

<style scoped lang="scss">
.settings-mobile {
  padding: 4px;
}

.page-title {
  margin: 4px 0 16px;
  font-size: 22px;
  font-weight: 600;
}

.section-card {
  margin-top: 12px;
}

h3 {
  margin: 0 0 14px;
  font-size: 16px;
  font-weight: 600;
}

.section-desc {
  margin-bottom: 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.w-full {
  width: 100%;
}

.lang-wrap :deep(.el-dropdown),
.lang-wrap :deep(.el-dropdown .el-button) {
  width: 100%;
}
</style>
