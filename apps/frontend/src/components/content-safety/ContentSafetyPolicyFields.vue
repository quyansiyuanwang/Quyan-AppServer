<template>
  <div class="content-safety-policy-fields">
    <el-form label-position="top" class="content-safety-policy-fields__form">
      <el-form-item :label="i18ns.t('contentSafety.request')">
        <div class="content-safety-policy-fields__row">
          <el-switch
            v-model="localModel.requestEnabled"
            :active-text="i18ns.t('contentSafety.enabled')"
          />
          <el-select
            v-model="localModel.requestAction"
            :disabled="!localModel.requestEnabled"
            style="min-width: 170px"
          >
            <el-option value="unreachable" :label="i18ns.t('contentSafety.unreachable')" />
            <el-option value="blackhole" :label="i18ns.t('contentSafety.blackhole')" />
            <el-option value="allow" :label="i18ns.t('contentSafety.allow')" />
          </el-select>
          <el-switch
            v-model="localModel.requestAiEnabled"
            :active-text="i18ns.t('contentSafety.aiEnabled')"
          />
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('contentSafety.response')">
        <div class="content-safety-policy-fields__row">
          <el-switch
            v-model="localModel.responseEnabled"
            :active-text="i18ns.t('contentSafety.enabled')"
          />
          <el-select
            v-model="localModel.responseAction"
            :disabled="!localModel.responseEnabled"
            style="min-width: 170px"
          >
            <el-option value="unreachable" :label="i18ns.t('contentSafety.unreachable')" />
            <el-option value="blackhole" :label="i18ns.t('contentSafety.blackhole')" />
            <el-option value="allow" :label="i18ns.t('contentSafety.allow')" />
          </el-select>
          <el-switch
            v-model="localModel.responseAiEnabled"
            :active-text="i18ns.t('contentSafety.aiEnabled')"
          />
        </div>
      </el-form-item>
    </el-form>
    <el-alert
      v-if="localModel.requestAiEnabled || localModel.responseAiEnabled"
      type="warning"
      :closable="false"
      show-icon
    >
      {{ i18ns.t('contentSafety.aiCostWarning') }}
    </el-alert>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import type { ContentSafetyAction } from '@appserver/shared'

interface PolicyModel {
  requestEnabled: boolean
  requestAction: ContentSafetyAction
  requestAiEnabled: boolean
  responseEnabled: boolean
  responseAction: ContentSafetyAction
  responseAiEnabled: boolean
}

const props = defineProps<{ model: PolicyModel }>()
const emit = defineEmits<{ 'update:model': [value: PolicyModel] }>()
const localModel = computed({
  get: () => props.model,
  set: (value) => emit('update:model', value),
})
</script>

<style scoped>
.content-safety-policy-fields__form {
  width: 100%;
}
.content-safety-policy-fields__row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
@media (max-width: 700px) {
  .content-safety-policy-fields__row {
    align-items: stretch;
    flex-direction: column;
  }
  .content-safety-policy-fields__row > * {
    width: 100%;
  }
}
</style>
