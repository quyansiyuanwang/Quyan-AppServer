<template>
  <el-dialog
    v-model="showChannelDialog"
    :title="isEditingChannel ? i18ns.t('relay.editChannel') : i18ns.t('relay.createChannel')"
    :width="isDesktop ? '60vw' : '650px'"
    destroy-on-close
  >
    <el-form :model="channelForm" label-width="180px" label-position="right">
      <el-form-item :label="i18ns.t('relay.channelName')" required>
        <el-input
          v-model="channelForm.name"
          :placeholder="i18ns.t('relay.channelNamePlaceholder')"
        />
      </el-form-item>

      <el-divider content-position="left">{{ i18ns.t('relay.channelComposition') }}</el-divider>
      <el-form-item :label="i18ns.t('relay.channelType')">
        <el-radio-group v-model="channelForm.channelType">
          <el-radio-button value="standalone">{{
            i18ns.t('relay.channelTypeStandalone')
          }}</el-radio-button>
          <el-radio-button value="pooled">{{ i18ns.t('relay.channelTypePooled') }}</el-radio-button>
        </el-radio-group>
        <div class="ml-3 text-[#909399] text-xs">
          {{ i18ns.t('relay.channelTypeHelp') }}
        </div>
      </el-form-item>

      <template v-if="channelForm.channelType === 'pooled'">
        <el-form-item :label="i18ns.t('relay.poolMembers')" required>
          <div class="flex flex-col gap-3 w-full">
            <div class="flex flex-wrap gap-2">
              <el-button size="small" @click="addPoolMember">{{
                i18ns.t('relay.addPoolMember')
              }}</el-button>
            </div>

            <el-empty
              v-if="channelForm.poolMembers.length === 0"
              :description="i18ns.t('relay.poolMembersHelp')"
            />

            <div
              v-for="(member, index) in channelForm.poolMembers"
              :key="member.id || `${member.memberChannelId}-${index}`"
              class="border border-[var(--el-border-color-lighter)] rounded-lg p-3 flex flex-col gap-3"
            >
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <el-form-item :label="i18ns.t('relay.poolMemberChannel')" label-width="auto">
                  <el-select
                    v-model="member.memberChannelId"
                    filterable
                    :placeholder="i18ns.t('select')"
                  >
                    <el-option
                      v-for="channel in availablePoolMemberChannels"
                      :key="channel.id"
                      :label="channel.name"
                      :value="channel.id"
                      :disabled="isPoolMemberOptionDisabled(channel.id, index)"
                    />
                  </el-select>
                </el-form-item>

                <el-form-item :label="i18ns.t('relay.poolMemberPriority')" label-width="auto">
                  <el-input-number v-model="member.priority" :min="1" :step="1" />
                </el-form-item>

                <el-form-item :label="i18ns.t('relay.poolMemberWeight')" label-width="auto">
                  <el-input-number v-model="member.weight" :min="0" :step="0.1" :precision="3" />
                </el-form-item>

                <el-form-item :label="i18ns.t('relay.poolMemberEnabled')" label-width="auto">
                  <el-switch v-model="member.enabled" />
                </el-form-item>
              </div>

              <div class="flex justify-end">
                <el-button size="small" type="danger" @click="removePoolMember(index)">{
                  { i18ns.t('delete') }
                }</el-button>
              </div>
            </div>

            <div class="text-[#909399] text-xs">{{ i18ns.t('relay.poolMembersHelp') }}</div>
          </div>
        </el-form-item>

        <el-divider content-position="left">{{ i18ns.t('relay.routingStrategy') }}</el-divider>
        <el-form-item :label="i18ns.t('relay.routingStrategy')">
          <el-select v-model="channelForm.routingStrategy" style="width: 100%">
            <el-option :label="i18ns.t('relay.routingStrategyPriority')" value="priority" />
            <el-option :label="i18ns.t('relay.routingStrategyRandom')" value="random" />
            <el-option
              :label="i18ns.t('relay.routingStrategyWeightedRandom')"
              value="weighted-random"
            />
            <el-option :label="i18ns.t('relay.routingStrategyRoundRobin')" value="round-robin" />
            <el-option
              :label="i18ns.t('relay.routingStrategyHealthPriority')"
              value="health-priority"
            />
            <el-option
              :label="i18ns.t('relay.routingStrategyLatencyPriority')"
              value="latency-priority"
            />
          </el-select>
          <div class="ml-3 text-[#909399] text-xs">{{ i18ns.t('relay.routingStrategyHelp') }}</div>
        </el-form-item>

        <el-form-item :label="i18ns.t('relay.routingConfig')">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
            <el-form-item :label="i18ns.t('relay.maxRetries')" label-width="auto">
              <el-input-number v-model="channelForm.routingConfig.maxRetries" :min="0" :step="1" />
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.failoverThreshold')" label-width="auto">
              <el-input-number
                v-model="channelForm.routingConfig.failoverThreshold"
                :min="0"
                :step="1"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.failbackCooldownMinutes')" label-width="auto">
              <el-input-number
                v-model="channelForm.routingConfig.failbackCooldownMinutes"
                :min="0"
                :step="1"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.healthScoreThreshold')" label-width="auto">
              <el-input-number
                v-model="channelForm.routingConfig.healthScoreThreshold"
                :min="0"
                :step="0.01"
                :precision="2"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.latencyThresholdMs')" label-width="auto">
              <el-input-number
                v-model="channelForm.routingConfig.latencyThresholdMs"
                :min="0"
                :step="10"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.circuitBreakerThreshold')" label-width="auto">
              <el-input-number
                v-model="channelForm.routingConfig.circuitBreakerThreshold"
                :min="0"
                :step="1"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.stickyByModel')" label-width="auto">
              <el-switch v-model="channelForm.routingConfig.stickyByModel" />
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.stickyByFormat')" label-width="auto">
              <el-switch v-model="channelForm.routingConfig.stickyByFormat" />
            </el-form-item>
          </div>
          <el-form-item :label="i18ns.t('relay.retryStatusCodes')" label-width="auto">
            <el-select
              v-model="channelForm.routingConfig.retryStatusCodes"
              multiple
              filterable
              allow-create
              default-first-option
              :placeholder="i18ns.t('relay.retryStatusCodesPlaceholder')"
              style="width: 100%"
            >
              <el-option :label="i18ns.t('relay.retryStatusCodeLabel4xx')" value="4xx" />
              <el-option :label="i18ns.t('relay.retryStatusCodeLabel5xx')" value="5xx" />
              <el-option :label="i18ns.t('relay.retryStatusCodeLabel401')" value="401" />
              <el-option :label="i18ns.t('relay.retryStatusCodeLabel403')" value="403" />
              <el-option :label="i18ns.t('relay.retryStatusCodeLabel429')" value="429" />
              <el-option :label="i18ns.t('relay.retryStatusCodeLabel500')" value="500" />
              <el-option :label="i18ns.t('relay.retryStatusCodeLabel502')" value="502" />
              <el-option :label="i18ns.t('relay.retryStatusCodeLabel503')" value="503" />
              <el-option :label="i18ns.t('relay.retryStatusCodeLabel504')" value="504" />
            </el-select>
          </el-form-item>
          <div class="ml-3 text-[#909399] text-xs">{{ i18ns.t('relay.routingConfigHelp') }}</div>
        </el-form-item>
      </template>

      <el-divider content-position="left">{{ i18ns.t('relay.visibilityMode') }}</el-divider>
      <el-form-item :label="i18ns.t('relay.visibilityMode')">
        <el-select v-model="channelForm.visibilityMode" style="width: 100%">
          <el-option :label="i18ns.t('relay.visibilityModePublic')" value="public" />
          <el-option :label="i18ns.t('relay.visibilityModePrivate')" value="private" />
          <el-option :label="i18ns.t('relay.visibilityModeWhitelist')" value="whitelist" />
        </el-select>
        <div class="ml-3 text-[#909399] text-xs">{{ i18ns.t('relay.visibilityModeHelp') }}</div>
      </el-form-item>

      <template v-if="channelForm.visibilityMode === 'whitelist'">
        <el-form-item :label="i18ns.t('relay.visibilityUsers')">
          <el-select
            v-model="channelForm.visibilityConfig.userIds"
            multiple
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            :placeholder="i18ns.t('relay.visibilityIdsPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('relay.visibilityGroups')">
          <el-select
            v-model="channelForm.visibilityConfig.groupIds"
            multiple
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            :placeholder="i18ns.t('relay.visibilityIdsPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="i18ns.t('relay.visibilityRoles')">
          <el-select
            v-model="channelForm.visibilityConfig.roleIds"
            multiple
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            :placeholder="i18ns.t('relay.visibilityIdsPlaceholder')"
          />
          <div class="ml-3 text-[#909399] text-xs">{{ i18ns.t('relay.visibilityIdsHelp') }}</div>
        </el-form-item>
      </template>

      <el-divider content-position="left">{{
        i18ns.t('relay.formatAndModelRestrictions')
      }}</el-divider>
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

      <template v-if="channelForm.channelType === 'standalone'">
        <el-divider
          v-if="computeShowUpstream(channelForm.allowedFormats, 'openai')"
          content-position="left"
        >
          {{ i18ns.t('relay.openaiUpstream') }}
        </el-divider>
        <template v-if="computeShowUpstream(channelForm.allowedFormats, 'openai')">
          <el-form-item :label="i18ns.t('ServerConfigView.openaiUpstreamUrl')">
            <el-input
              v-model="channelForm.openaiUpstreamUrl"
              placeholder="https://api.openai.com/v1"
            />
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
            <el-input
              v-model="channelForm.anthropicUpstreamApiKey"
              type="password"
              show-password
            />
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
      </template>
      <el-alert
        v-else
        type="info"
        :closable="false"
        class="mb-4"
        :title="i18ns.t('relay.pooledNoDirectUpstreamHelp')"
      />

      <el-divider content-position="left">{{ i18ns.t('relay.channelSettings') }}</el-divider>
      <el-form-item :label="i18ns.t('relay.channelMultiplier')">
        <el-input-number v-model="channelForm.multiplier" :step="0.000001" :precision="6" />
        <span class="ml-3 text-[#909399] text-xs">{{
          i18ns.t('relay.channelMultiplierHelp')
        }}</span>
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
          <ModelMappingEditor
            v-model="channelForm.modelMapping"
            :available-models="filteredModelNames"
          />
          <span class="text-[#909399] text-xs">{{ i18ns.t('relay.modelMappingHelp') }}</span>
        </div>
      </el-form-item>

      <el-divider content-position="left">{{ i18ns.t('relay.timeRules') }}</el-divider>
      <el-form-item label="">
        <div class="flex flex-col gap-2 w-full">
          <el-button size="small" @click="openAddTimeRule">{{
            i18ns.t('relay.timeRuleAdd')
          }}</el-button>
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
                  <el-tag :type="row.multiplier >= 1 ? 'warning' : 'success'" size="small"
                    >{{ row.multiplier }}x</el-tag
                  >
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('relay.timeRuleEnabled')" width="70">
                <template #default="{ row }">
                  <el-switch v-model="row.enabled" size="small" />
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('actions')" width="140" fixed="right">
                <template #default="{ $index }">
                  <el-button size="small" @click="openEditTimeRule($index)">{{
                    i18ns.t('edit')
                  }}</el-button>
                  <el-button size="small" type="danger" @click="removeTimeRule($index)">{{
                    i18ns.t('delete')
                  }}</el-button>
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
                <el-tag :type="rule.multiplier >= 1 ? 'warning' : 'success'" size="small"
                  >{{ rule.multiplier }}x</el-tag
                >
                <div class="flex gap-1">
                  <el-button size="small" @click="openEditTimeRule(idx)">{{
                    i18ns.t('edit')
                  }}</el-button>
                  <el-button size="small" type="danger" @click="removeTimeRule(idx)">{{
                    i18ns.t('delete')
                  }}</el-button>
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
  availablePoolMemberChannels,
  isPoolMemberOptionDisabled,
  addPoolMember,
  removePoolMember,
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
