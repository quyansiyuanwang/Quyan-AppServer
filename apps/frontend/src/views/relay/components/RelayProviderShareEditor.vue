<template>
  <div class="relay-provider-editor">
    <div class="relay-provider-editor__summary">
      <span>{{ i18ns.t('relay.providerTotalCommission') }}</span>
      <el-tag :type="total > 100 ? 'warning' : 'info'">{{ total.toFixed(2) }}%</el-tag>
      <span class="relay-provider-editor__remainder">
        {{ i18ns.t('relay.providerPlatformRemainder') }}: {{ (100 - total).toFixed(2) }}%
      </span>
    </div>

    <div v-if="providers.length" class="relay-provider-editor__list">
      <div v-for="(provider, index) in providers" :key="`${provider.userId}-${index}`" class="relay-provider-editor__row">
        <el-select
          :model-value="provider.userId"
          filterable
          remote
          reserve-keyword
          :remote-method="(keyword: string) => emit('search-users', keyword)"
          :loading="usersLoading"
          class="relay-provider-editor__user"
          :placeholder="i18ns.t('relay.providerUser')"
          @update:model-value="(value: string) => update(index, { userId: value })"
        >
          <el-option v-for="user in userOptions" :key="user.id" :label="userLabel(user)" :value="user.id">
            <div class="relay-provider-editor__option">
              <strong>{{ user.username }}</strong>
              <span v-if="user.name">{{ user.name }}</span>
            </div>
          </el-option>
        </el-select>
        <el-input-number
          :model-value="provider.commissionPercent"
          :min="0"
          :max="100"
          :precision="4"
          :step="1"
          controls-position="right"
          class="relay-provider-editor__percent"
          @update:model-value="(value: number | undefined) => update(index, { commissionPercent: value ?? 0 })"
        />
        <el-select
          :model-value="provider.settlementMode"
          class="relay-provider-editor__settlement"
          :placeholder="i18ns.t('relay.providerSettlementMode')"
          @update:model-value="(value: RelayChannelProviderConfigRequest['settlementMode']) => update(index, { settlementMode: value })"
        >
          <el-option value="realtime" :label="i18ns.t('relay.settlementModeRealtime')" />
          <el-option value="interval" :label="i18ns.t('relay.settlementModeInterval')" />
          <el-option value="daily" :label="i18ns.t('relay.settlementModeDaily')" />
          <el-option value="manual" :label="i18ns.t('relay.settlementModeManual')" />
        </el-select>
        <el-input-number
          v-if="provider.settlementMode === 'interval'"
          :model-value="provider.settlementIntervalDays"
          :min="1"
          :step="1"
          controls-position="right"
          class="relay-provider-editor__extra"
          :placeholder="i18ns.t('relay.providerIntervalDays')"
          @update:model-value="(value: number | undefined) => update(index, { settlementIntervalDays: value })"
        />
        <el-time-picker
          v-else-if="provider.settlementMode === 'daily'"
          :model-value="provider.settlementTime"
          value-format="HH:mm"
          format="HH:mm"
          class="relay-provider-editor__extra"
          :placeholder="i18ns.t('relay.providerSettlementTime')"
          @update:model-value="(value: string | undefined) => update(index, { settlementTime: value })"
        />
        <div v-else class="relay-provider-editor__extra" />
        <el-button text type="danger" :icon="Delete" :aria-label="i18ns.t('delete')" @click="remove(index)" />
      </div>
    </div>
    <el-empty v-else :description="i18ns.t('relay.noProviders')" :image-size="56" />

    <el-button plain size="small" :icon="Plus" @click="add">
      {{ i18ns.t('relay.providerAdd') }}
    </el-button>
    <div class="hint">{{ i18ns.t('relay.providerSubmitterAutoAdd') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import type { RelayChannelProviderConfigRequest } from '@/client/types.gen'

export type RelayProviderUserOption = { id: string; username: string; name?: string | null }

const props = withDefaults(
  defineProps<{
    providers: RelayChannelProviderConfigRequest[]
    userOptions?: RelayProviderUserOption[]
    usersLoading?: boolean
  }>(),
  { userOptions: () => [], usersLoading: false },
)
const emit = defineEmits<{
  'update:providers': [value: RelayChannelProviderConfigRequest[]]
  'search-users': [keyword: string]
}>()
const providers = computed(() => props.providers)
const total = computed(() => providers.value.reduce((sum, provider) => sum + Number(provider.commissionPercent || 0), 0))
const userLabel = (user: RelayProviderUserOption) => (user.name ? `${user.username} (${user.name})` : user.username)
const update = (index: number, patch: Partial<RelayChannelProviderConfigRequest>) => {
  emit('update:providers', providers.value.map((provider, itemIndex) => (itemIndex === index ? { ...provider, ...patch } : provider)))
}
const add = () => {
  emit('update:providers', [
    ...providers.value,
    { userId: '', commissionPercent: 0, settlementMode: 'manual' },
  ])
}
const remove = (index: number) => emit('update:providers', providers.value.filter((_, itemIndex) => itemIndex !== index))
</script>

<style scoped lang="scss">
.relay-provider-editor { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.relay-provider-editor__summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--el-text-color-secondary); font-size: 13px; }
.relay-provider-editor__remainder { margin-left: 4px; }
.relay-provider-editor__list { display: flex; flex-direction: column; gap: 10px; }
.relay-provider-editor__row { display: grid; grid-template-columns: minmax(190px, 1.4fr) minmax(110px, .7fr) minmax(150px, 1fr) minmax(140px, .9fr) auto; gap: 8px; align-items: center; padding: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-blank); }
.relay-provider-editor__user, .relay-provider-editor__settlement, .relay-provider-editor__extra, .relay-provider-editor__percent { width: 100%; min-width: 0; }
.relay-provider-editor__option { display: flex; gap: 8px; align-items: baseline; }
.relay-provider-editor__option span { color: var(--el-text-color-secondary); font-size: 12px; }
.hint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
@media (max-width: 900px) { .relay-provider-editor__row { grid-template-columns: repeat(2, minmax(0, 1fr)); } .relay-provider-editor__user { grid-column: 1 / -1; } }
@media (max-width: 560px) { .relay-provider-editor__row { grid-template-columns: 1fr; } .relay-provider-editor__user { grid-column: auto; } }
</style>
