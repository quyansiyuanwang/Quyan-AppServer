<template>
  <div class="card-header toolbar-row">
    <div>
      <span class="card-title">{{ i18ns.t(titleKey) }}</span>
      <p v-if="section === 'overview'" class="ram-section-description">
        {{ i18ns.t('RamManagement.overviewDescription') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { i18ns, type I18nENAvailableKeys } from '@/locales'
import type { RamManagementSection } from '../useRamManagement'

const props = defineProps<{ section: RamManagementSection }>()

const titleKey = computed<I18nENAvailableKeys>(() => {
  const titles: Record<RamManagementSection, I18nENAvailableKeys> = {
    overview: 'RamManagement.overview',
    users: 'RamManagement.users',
    roles: 'RamManagement.roles',
    bindings: 'RamManagement.bindings',
    policies: 'RamManagement.policies',
    authorization: 'RamManagement.authorization',
    sessions: 'RamManagement.sessions',
  }
  return titles[props.section]
})
</script>
