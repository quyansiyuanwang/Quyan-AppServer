<template>
  <el-tooltip
    :content="languageButtonTitle"
    placement="top"
    :show-after="250"
    :disabled="dropdownVisible"
  >
    <el-dropdown @command="handleCommand" @visible-change="handleVisibleChange">
      <el-button
        :title="languageButtonTitle"
        :aria-label="languageButtonTitle"
        :class="{ 'is-compact': compact }"
      >
        <span class="language-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
            <path
              d="M3.5 12h17M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9m0-18c-2.6 2.4-4 5.6-4 9s1.4 6.6 4 9m-6.5-6h13"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.6"
            />
          </svg>
        </span>
        <span v-if="!compact">{{ currentLocaleName }}</span>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="zh-CN" :disabled="currentLocale === 'zh-CN'">
            {{ i18ns.t('localeName.zhCN') }}
          </el-dropdown-item>
          <el-dropdown-item command="en" :disabled="currentLocale === 'en'">
            {{ i18ns.t('localeName.en') }}
          </el-dropdown-item>
          <el-dropdown-item command="emoji" :disabled="currentLocale === 'emoji'">
            {{ i18ns.t('localeName.emoji') }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18nStore } from '@/stores/i18nStore'
import { i18ns } from '@/locales'
import type { Locale } from '@/locales'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const i18nStore = useI18nStore()
const dropdownVisible = ref(false)

// expose a simple string ref (no nested ref)
const currentLocale = computed(() => i18nStore.currentLocale)

const currentLocaleName = computed(() => {
  if (currentLocale.value === 'zh-CN') return i18ns.t('localeName.zhCN')
  if (currentLocale.value === 'en') return i18ns.t('localeName.en')
  return i18ns.t('localeName.emoji')
})

const languageButtonTitle = computed(() =>
  i18ns.t('floatingOverlay.switchLanguageCurrent', { current: currentLocaleName.value }),
)

const handleCommand = (command: Locale) => {
  void i18nStore.changeLocale(command)
}

const handleVisibleChange = (visible: boolean) => {
  dropdownVisible.value = visible
}
</script>

<style scoped>
.el-button {
  display: flex;
  align-items: center;
  gap: 8px;
}

.el-button.is-compact {
  width: 34px;
  padding: 0;
}

.language-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  line-height: 1;
}

.language-icon svg {
  width: 100%;
  height: 100%;
}
</style>
