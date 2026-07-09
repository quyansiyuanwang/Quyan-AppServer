<template>
  <el-dialog
    v-model="showChannelDialog"
    :title="isEditingChannel ? i18ns.t('relay.editChannel') : i18ns.t('relay.createChannel')"
    :width="isDesktop ? '60vw' : '650px'"
    destroy-on-close
  >
    <el-form :model="channelForm" label-width="180px" label-position="right">
      <el-form-item :label="i18ns.t('relay.channelName')" required>
        <el-input v-model="channelForm.name" :placeholder="i18ns.t('relay.channelNamePlaceholder')" />
      </el-form-item>

      <el-divider content-position="left">{{ i18ns.t('relay.formatAndModelRestrictions') }}</el-divider>
      <el-form-item :label="i18ns.t('relay.allowedFormats')" required>
        <el-select
          v-model="channelForm.allowedFormats"
          :placeholder="i18ns.t('select')"
          multiple
          collapse-tags
          collapse-tags-tooltip
          :max-collapse-tags="2"
          style="width: 100%"
        >
          <el-option :label="i18ns.t('relay.formatOpenAI')" value="openai" />
          <el-option :label="i18ns.t('relay.formatAnthropic')" value="anthropic" />
          <el-option :label="i18ns.t('relay.formatGemini')" value="gemini" />
        </el-select>
        <div class="ml-3 text-[#909399] text-xs">
          {{ i18ns.t('relay.allowedFormatsHelp') }}
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('relay.allowedModelsChannel')">
        <el-switch
          v-model="channelForm.restrictModels"
          :active-text="i18ns.t('relay.restrictModels')"
          :inactive-text="i18ns.t('relay.allowAllModels')"
          style="margin-bottom: 12px"
        />
        <el-select
          v-if="channelForm.restrictModels"
          v-model="channelForm.allowedModelsArray"
          multiple
          filterable
          allow-create
          :placeholder="i18ns.t('relay.allowedModelsChannelHelp')"
          style="width: 100%"
        >
          <el-option
            v-for="model in filteredModels"
            :key="model.model"
            :label="formatModelOptionLabel(model)"
            :value="model.model"
            :disabled="isModelDisabled(model)"
          />
        </el-select>
        <div class="ml-3 text-[#909399] text-xs">
          {{ i18ns.t('relay.allowedModelsChannelHelp') }}
        </div>
      </el-form-item>

      <el-divider
        v-if="computeShowUpstream(channelForm.allowedFormats, 'openai')"
        content-position="left"
      >
        {{ i18ns.t('relay.openaiUpstream') }}
      </el-divider>
      <template v-if="computeShowUpstream(channelForm.allowedFormats, 'openai')">
        <el-form-item :label="i18ns.t('ServerConfigView.openaiUpstreamUrl')">
          <el-input v-model="channelForm.openaiUpstreamUrl" placeholder="https://api.openai.com/v1" />
        </el-form-item>
        <el-form-item :label="i18ns.t('ServerConfigView.openaiUpstreamApiKey')">
          <el-input v-model="channelForm.openaiUpstreamApiKey" type="password" show-password />
        </el-form-item>
      </template>

      <el-divider
        v-if="computeShowUpstream(channelForm.allowedFormats, 'anthropic')"
        content-position="left"
      >
        {{ i18ns.t('relay.anthropicUpstream') }}
      </el-divider>
      <template v-if="computeShowUpstream(channelForm.allowedFormats, 'anthropic')">
        <el-form-item :label="i18ns.t('ServerConfigView.anthropicUpstreamUrl')">
          <el-input
            v-model="channelForm.anthropicUpstreamUrl"
            placeholder="https://api.anthropic.com/v1"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('ServerConfigView.anthropicUpstreamApiKey')">
          <el-input v-model="channelForm.anthropicUpstreamApiKey" type="password" show-password />
        </el-form-item>
      </template>

      <el-divider
        v-if="computeShowUpstream(channelForm.allowedFormats, 'gemini')"
        content-position="left"
      >
        {{ i18ns.t('relay.geminiUpstream') }}
      </el-divider>
      <template v-if="computeShowUpstream(channelForm.allowedFormats, 'gemini')">
        <el-form-item :label="i18ns.t('ServerConfigView.geminiUpstreamUrl')">
          <el-input
            v-model="channelForm.geminiUpstreamUrl"
            placeholder="https://generativelanguage.googleapis.com"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('ServerConfigView.geminiUpstreamApiKey')">
          <el-input v-model="channelForm.geminiUpstreamApiKey" type="password" show-password />
        </el-form-item>
      </template>

      <el-divider content-position="left">{{ i18ns.t('relay.channelSettings') }}</el-divider>
      <el-form-item :label="i18ns.t('relay.channelMultiplier')">
        <el-input-number v-model="channelForm.multiplier" :step="0.000001" :precision="6" />
        <span class="ml-3 text-[#909399] text-xs">{{ i18ns.t('relay.channelMultiplierHelp') }}</span>
      </el-form-item>
      <el-form-item v-if="isDesktop" :label="i18ns.t('relay.inputTokensIncludeCacheRead')">
        <el-switch v-model="channelForm.inputTokensIncludeCacheRead" />
        <span class="ml-3 text-[#909399] text-xs">{{
          i18ns.t('relay.inputTokensIncludeCacheReadHelp')
        }}</span>
      </el-form-item>

      <el-divider content-position="left">{{ i18ns.t('relay.modelMappingSection') }}</el-divider>
      <el-form-item :label="i18ns.t('relay.modelMapping')">
        <div class="flex flex-col gap-1 w-full">
          <ModelMappingEditor v-model="channelForm.modelMapping" :available-models="filteredModelNames" />
          <span class="text-[#909399] text-xs">{{ i18ns.t('relay.modelMappingHelp') }}</span>
        </div>
      </el-form-item>

      <el-divider content-position="left">{{ i18ns.t('relay.timeRules') }}</el-divider>
      <el-form-item label="">
        <div class="flex flex-col gap-2 w-full">
          <el-button size="small" @click="openAddTimeRule">{{ i18ns.t('relay.timeRuleAdd') }}</el-button>
          <template v-if="isDesktop">
            <el-table :data="channelForm.timePeriodMultipliers" size="small" max-height="300">
              <el-table-column prop="name" :label="i18ns.t('relay.timeRuleName')" min-width="100" />
              <el-table-column :label="i18ns.t('relay.timeRuleDays')" min-width="120">
                <template #default="{ row }">
                  {{ formatTimeRuleDays(row.dayOfWeek) }}
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('relay.timeRuleTimeRange')" min-width="120">
                <template #default="{ row }">{{ row.startTime }} - {{ row.endTime }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('relay.timeRuleMultiplier')" width="80">
                <template #default="{ row }">
                  <el-tag :type="row.multiplier >= 1 ? 'warning' : 'success'" size="small">{{ row.multiplier }}x</el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('relay.timeRuleEnabled')" width="70">
                <template #default="{ row }">
                  <el-switch v-model="row.enabled" size="small" />
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('actions')" width="140" fixed="right">
                <template #default="{ $index }">
                  <el-button size="small" @click="openEditTimeRule($index)">{{ i18ns.t('edit') }}</el-button>
                  <el-button size="small" type="danger" @click="removeTimeRule($index)">{{ i18ns.t('delete') }}</el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
          <template v-else>
            <div
              v-for="(rule, idx) in channelForm.timePeriodMultipliers"
              :key="idx"
              class="mobile-card time-rule-card"
            >
              <div class="flex justify-between items-center">
                <span class="font-medium">{{ rule.name }}</span>
                <el-switch v-model="rule.enabled" size="small" />
              </div>
              <div class="text-sm text-[#909399] mt-1">
                {{ formatTimeRuleDays(rule.dayOfWeek) }} · {{ rule.startTime }} - {{ rule.endTime }}
              </div>
              <div class="flex justify-between items-center mt-1">
                <el-tag :type="rule.multiplier >= 1 ? 'warning' : 'success'" size="small">{{ rule.multiplier }}x</el-tag>
                <div class="flex gap-1">
                  <el-button size="small" @click="openEditTimeRule(idx)">{{ i18ns.t('edit') }}</el-button>
                  <el-button size="small" type="danger" @click="removeTimeRule(idx)">{{ i18ns.t('delete') }}</el-button>
                </div>
              </div>
            </div>
          </template>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showChannelDialog = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" :loading="channelSaving" @click="handleSaveChannel">
        {{ i18ns.t('confirm') }}
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="showChannelImportDialog"
    :title="i18ns.t('relay.channelImportDialogTitle')"
    width="600px"
    append-to-body
  >
    <el-input
      v-model="channelImportText"
      type="textarea"
      :rows="12"
      :placeholder="channelImportPlaceholder"
    />
    <template #footer>
      <el-button @click="showChannelImportDialog = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" @click="handleImportChannels">{{ i18ns.t('confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import ModelMappingEditor from '@/components/relay/ModelMappingEditor.vue'
import { i18ns } from '@/locales'
import { useRelaySettingsManagementContext } from '../context'

const state = useRelaySettingsManagementContext()

const {
  isDesktop,
  showChannelDialog,
  isEditingChannel,
  channelForm,
  filteredModels,
  formatModelOptionLabel,
  isModelDisabled,
  computeShowUpstream,
  filteredModelNames,
  openAddTimeRule,
  formatTimeRuleDays,
  openEditTimeRule,
  removeTimeRule,
  channelSaving,
  handleSaveChannel,
  showChannelImportDialog,
  channelImportText,
  channelImportPlaceholder,
  handleImportChannels,
} = state
</script>
