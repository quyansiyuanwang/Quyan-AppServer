<template>
  <el-collapse-item name="ai-resources">
    <template #title
      ><span class="collapse-title">{{
        i18ns.t('ServerConfigView.aiResources.title')
      }}</span></template
    >
    <div v-loading="loading">
      <el-alert
        :title="i18ns.t('ServerConfigView.aiResources.help')"
        type="info"
        :closable="false"
        show-icon
      />
      <el-alert
        v-if="configuration?.legacyEnvironmentPresent"
        :title="i18ns.t('ServerConfigView.aiResources.legacy')"
        type="warning"
        :closable="false"
      />
      <el-collapse v-if="draft && configuration">
        <el-collapse-item
          v-for="group in groups"
          :key="group"
          :name="group"
          :title="groupLabel(group)"
        >
          <el-form label-position="top">
            <el-form-item
              v-for="field in configuration.fields.filter((item) => item.group === group)"
              :key="field.path"
              :label="fieldLabel(field)"
            >
              <el-input-number
                :model-value="readValue(field)"
                :min="field.min"
                :max="field.max"
                :step="1"
                @update:model-value="(value: number | undefined) => writeValue(field, value)"
              />
              <span class="form-help"
                >{{ field.unit }} · {{ i18ns.t('ServerConfigView.aiResources.default') }}
                {{ defaultValue(field) }}</span
              >
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>
      <el-button type="primary" :loading="saving" :disabled="!draft" @click="save">{{
        i18ns.t('ServerConfigView.aiResources.save')
      }}</el-button>
      <el-button :disabled="!configuration" @click="reset">{{
        i18ns.t('ServerConfigView.aiResources.reset')
      }}</el-button>
      <el-button :loading="loading" @click="load">{{
        i18ns.t('ServerConfigView.aiResources.reload')
      }}</el-button>
    </div>
  </el-collapse-item>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue'
import { configService } from '@/service/configService'
import { i18ns } from '@/locales'
import { ElMessage } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import type {
  AiResourceConfigurationDto,
  AiResourceFieldDto,
  AiResourceSettingsDto,
} from '@/client/types.gen'
const loading = ref(false),
  saving = ref(false)
const configuration = ref<AiResourceConfigurationDto>()
const draft = ref<AiResourceSettingsDto>()
const groups = computed(() => [
  ...new Set(configuration.value?.fields.map((field) => field.group) ?? []),
])
const groupLabels = computed(() => ({
  admission: i18ns.t('ServerConfigView.aiResources.admission'),
  streaming: i18ns.t('ServerConfigView.aiResources.streaming'),
  chat: i18ns.t('ServerConfigView.aiResources.chat'),
  audit: i18ns.t('ServerConfigView.aiResources.audit'),
  http: i18ns.t('ServerConfigView.aiResources.http'),
  relay: i18ns.t('ServerConfigView.aiResources.relay'),
  rules: i18ns.t('ServerConfigView.aiResources.rules'),
}))
const groupLabel = (group: string) =>
  groupLabels.value[group as keyof typeof groupLabels.value] ?? group
const fieldLabel = (field: AiResourceFieldDto) =>
  i18ns.locale === 'en' ? field.labelEn : field.label
function getPath(value: unknown, path: string): number {
  return path.split('.').reduce((obj: any, key) => obj[key], value) as number
}
function readValue(field: AiResourceFieldDto) {
  return draft.value ? getPath(draft.value, field.path) / field.scale : 0
}
function defaultValue(field: AiResourceFieldDto) {
  return configuration.value ? getPath(configuration.value.defaults, field.path) / field.scale : 0
}
function writeValue(field: AiResourceFieldDto, value: number | undefined) {
  if (!draft.value || value === undefined) return
  const keys = field.path.split('.')
  const last = keys.pop()!
  const target = keys.reduce((obj: any, key) => obj[key], draft.value as any)
  target[last] = value * field.scale
}
async function load() {
  loading.value = true
  try {
    configuration.value = await configService.getAIResourceConfiguration()
    draft.value = structuredClone(toRaw(configuration.value.effective))
  } catch (error) {
    showRequestErrorNotice(error)
  } finally {
    loading.value = false
  }
}
function reset() {
  if (configuration.value) draft.value = structuredClone(toRaw(configuration.value.defaults))
}
async function save() {
  if (!draft.value || !configuration.value) return
  saving.value = true
  try {
    await configService.setConfigs({ [configuration.value.configKey]: JSON.stringify(draft.value) })
    ElMessage.success(i18ns.t('ServerConfigView.aiResources.saved'))
    await load()
  } catch (error) {
    showRequestErrorNotice(error)
  } finally {
    saving.value = false
  }
}
onMounted(load)
</script>
