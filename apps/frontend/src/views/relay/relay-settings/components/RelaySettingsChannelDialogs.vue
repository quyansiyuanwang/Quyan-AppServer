<template>
  <el-drawer
    v-model="showChannelDialog"
    :title="isEditingChannel ? i18ns.t('relay.editChannel') : i18ns.t('relay.createChannel')"
    :direction="isDesktop ? 'rtl' : 'btt'"
    :size="isDesktop ? 'min(1120px, calc(100vw - 64px))' : '100%'"
    class="relay-channel-editor-drawer"
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
          <el-radio-button value="automatic-proxy-pool">{{
            i18ns.t('relay.channelTypeAutomaticProxyPool')
          }}</el-radio-button>
        </el-radio-group>
        <div class="ml-3 text-[#909399] text-xs">
          {{ i18ns.t('relay.channelTypeHelp') }}
        </div>
      </el-form-item>

      <template v-if="['pooled', 'automatic-proxy-pool'].includes(channelForm.channelType)">
        <el-form-item :label="i18ns.t('relay.poolMembers')" required>
          <div class="relay-pool-member-editor">
            <div class="relay-pool-member-editor__toolbar">
              <el-button size="small" type="primary" @click="openPoolMemberPicker">{{
                i18ns.t('relay.addPoolMember')
              }}</el-button>
              <span>{{ i18ns.t('relay.poolMembersHelp') }}</span>
            </div>
            <div ref="poolMemberSortableRef" class="relay-pool-member-editor__rows">
              <div
                v-for="(member, index) in channelForm.poolMembers"
                :key="member.id || member.memberChannelId"
                class="relay-pool-member-row"
                :class="{ 'is-unavailable': member.memberChannelEnabled === false }"
                :data-index="index"
              >
                <el-icon class="relay-pool-member-row__drag"><Rank /></el-icon>
                <span class="relay-pool-member-row__priority">#{{ index + 1 }}</span>
                <span class="relay-pool-member-row__name">
                  <span class="relay-pool-member-row__name-label">{{
                    member.memberChannelName || getChannelNameById(member.memberChannelId)
                  }}</span>
                  <el-tag
                    v-if="member.memberChannelEnabled === false"
                    size="small"
                    type="danger"
                    effect="plain"
                  >
                    {{ i18ns.t('relay.poolMemberChannelDisabled') }}
                  </el-tag>
                </span>
                <el-input-number
                  v-model="member.weight"
                  :min="0"
                  :step="0.1"
                  :precision="3"
                  size="small"
                />
                <el-switch v-model="member.enabled" size="small" />
                <el-tooltip :content="i18ns.t('relay.poolMemberPriority')"
                  ><el-button
                    text
                    circle
                    :disabled="index === 0"
                    @click="movePoolMemberToEdge(index, 'top')"
                    ><el-icon><Top /></el-icon></el-button
                ></el-tooltip>
                <el-tooltip :content="i18ns.t('delete')"
                  ><el-button text circle type="danger" @click="removePoolMember(index)"
                    ><el-icon><Delete /></el-icon></el-button
                ></el-tooltip>
              </div>
              <el-empty
                v-if="channelForm.poolMembers.length === 0"
                :description="i18ns.t('relay.poolMembersHelp')"
              />
            </div>
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
          <div class="mb-3 flex flex-wrap gap-2 w-full">
            <el-button size="small" @click="resetRoutingConfigToRecommended">
              {{ i18ns.t('relay.restoreRecommendedRoutingConfig') }}
            </el-button>
            <el-button size="small" @click="clearOptionalRoutingThresholds">
              {{ i18ns.t('relay.clearOptionalThresholds') }}
            </el-button>
          </div>
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
              style="width: 500px"
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
          <div class="ml-3 text-[#909399] text-xs">
            {{ i18ns.t('relay.routingConfigOptionalThresholdsHelp') }}
          </div>
        </el-form-item>
      </template>

      <el-divider content-position="left">{{ i18ns.t('relay.visibilityMode') }}</el-divider>
      <el-form-item :label="i18ns.t('relay.visibilityMode')">
        <el-select v-model="channelForm.visibilityMode" style="width: 100%">
          <el-option :label="i18ns.t('relay.visibilityModePublic')" value="public" />
          <el-option :label="i18ns.t('relay.visibilityModePrivate')" value="private" />
          <el-option :label="i18ns.t('relay.visibilityModeWhitelist')" value="whitelist" />
          <el-option :label="i18ns.t('relay.visibilityModeHidden')" value="hidden" />
        </el-select>
        <div class="ml-3 text-[#909399] text-xs">{{ i18ns.t('relay.visibilityModeHelp') }}</div>
        <div
          v-if="channelForm.visibilityMode === 'hidden'"
          class="ml-3 text-[var(--el-color-warning)] text-xs"
        >
          {{ i18ns.t('relay.visibilityModeHiddenHelp') }}
        </div>
      </el-form-item>

      <template v-if="channelForm.visibilityMode === 'whitelist'">
        <el-form-item :label="i18ns.t('relay.visibilityUsers')">
          <el-select
            v-model="channelForm.visibilityConfig.userIds"
            multiple
            filterable
            remote
            allow-create
            default-first-option
            :remote-method="handleVisibilityUserSearch"
            :loading="visibilityUserOptionsLoading"
            style="width: 100%"
            :placeholder="i18ns.t('relay.visibilityUsersPlaceholder')"
          >
            <el-option
              v-for="user in visibilityUserOptions"
              :key="user.id"
              :label="formatVisibilityUserOption(user)"
              :value="user.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="i18ns.t('relay.visibilityGroups')">
          <el-select
            v-model="channelForm.visibilityConfig.groupIds"
            multiple
            filterable
            allow-create
            default-first-option
            :loading="visibilityGroupOptionsLoading"
            style="width: 100%"
            :placeholder="i18ns.t('relay.visibilityGroupsPlaceholder')"
          >
            <el-option
              v-for="group in visibilityGroupOptions"
              :key="group.id"
              :label="formatVisibilityGroupOption(group)"
              :value="group.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="i18ns.t('relay.visibilityRoles')">
          <el-select
            v-model="channelForm.visibilityConfig.roleIds"
            multiple
            filterable
            allow-create
            default-first-option
            :loading="visibilityRoleOptionsLoading"
            style="width: 100%"
            :placeholder="i18ns.t('relay.visibilityRolesPlaceholder')"
          >
            <el-option
              v-for="role in visibilityRoleOptions"
              :key="role.id"
              :label="formatVisibilityRoleOption(role)"
              :value="role.id"
            />
          </el-select>
          <div class="ml-3 text-[#909399] text-xs">{{ i18ns.t('relay.visibilityIdsHelp') }}</div>
        </el-form-item>
      </template>

      <el-divider content-position="left">{{
        i18ns.t('relay.formatAndModelRestrictions')
      }}</el-divider>
      <el-form-item
        v-if="channelForm.channelType === 'standalone'"
        :label="i18ns.t('relay.allowedFormats')"
        required
      >
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
        <template v-if="['pooled', 'automatic-proxy-pool'].includes(channelForm.channelType)">
          <el-radio-group v-model="channelForm.pooledAllowedModelsMode" style="margin-bottom: 12px">
            <el-radio-button label="all">{{
              i18ns.t('relay.allowedModelsModeAll')
            }}</el-radio-button>
            <el-radio-button label="auto">{{
              i18ns.t('relay.allowedModelsModeAuto')
            }}</el-radio-button>
            <el-radio-button label="manual">{{
              i18ns.t('relay.allowedModelsModeManual')
            }}</el-radio-button>
          </el-radio-group>
          <el-select
            v-if="channelForm.pooledAllowedModelsMode === 'manual'"
            v-model="channelForm.allowedModelsArray"
            multiple
            filterable
            allow-create
            :placeholder="i18ns.t('relay.allowedModelsManualPlaceholder')"
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
            {{ i18ns.t('relay.allowedModelsPooledHelp') }}
          </div>
        </template>
        <template v-else>
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
            :placeholder="i18ns.t('relay.allowedModelsManualPlaceholder')"
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
        </template>
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
            <el-input
              v-model="channelForm.openaiUpstreamApiKey"
              type="password"
              show-password
              @update:model-value="channelForm.openaiUpstreamApiKeyTouched = true"
            />
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
              @update:model-value="channelForm.anthropicUpstreamApiKeyTouched = true"
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
            <el-input
              v-model="channelForm.geminiUpstreamApiKey"
              type="password"
              show-password
              @update:model-value="channelForm.geminiUpstreamApiKeyTouched = true"
            />
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

      <el-divider
        content-position="left"
        v-if="!['pooled', 'automatic-proxy-pool'].includes(channelForm.channelType)"
        >{{ i18ns.t('relay.channelSettings') }}</el-divider
      >
      <el-form-item
        v-if="!['pooled', 'automatic-proxy-pool'].includes(channelForm.channelType)"
        :label="i18ns.t('relay.channelMultiplier')"
      >
        <el-input-number v-model="channelForm.multiplier" :step="0.000001" :precision="6" />
        <span class="ml-3 text-[#909399] text-xs">{{
          i18ns.t('relay.channelMultiplierHelp')
        }}</span>
      </el-form-item>
      <el-form-item
        v-if="isDesktop && !['pooled', 'automatic-proxy-pool'].includes(channelForm.channelType)"
        :label="i18ns.t('relay.inputTokensIncludeCacheRead')"
      >
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

      <template v-if="!['pooled', 'automatic-proxy-pool'].includes(channelForm.channelType)">
        <el-divider content-position="left">{{ i18ns.t('relay.timeRules') }}</el-divider>
        <el-form-item label="">
          <div class="flex flex-col gap-2 w-full">
            <el-button size="small" @click="openAddTimeRule">{{
              i18ns.t('relay.timeRuleAdd')
            }}</el-button>
            <template v-if="isDesktop">
              <el-table :data="channelForm.timePeriodMultipliers" size="small" max-height="300">
                <el-table-column
                  prop="name"
                  :label="i18ns.t('relay.timeRuleName')"
                  min-width="100"
                />
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
                  {{ formatTimeRuleDays(rule.dayOfWeek) }} · {{ rule.startTime }} -
                  {{ rule.endTime }}
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
      </template>
    </el-form>
    <template #footer>
      <div class="relay-channel-editor-drawer__footer">
        <el-button @click="showChannelDialog = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="channelSaving" @click="handleSaveChannel">
          {{ i18ns.t('save') }}
        </el-button>
      </div>
    </template>
  </el-drawer>

  <el-dialog
    v-model="showPoolMemberPicker"
    :title="i18ns.t('relay.addPoolMember')"
    width="720px"
    append-to-body
  >
    <div class="relay-pool-member-picker__toolbar">
      <el-input
        v-model="poolMemberPickerKeyword"
        clearable
        :placeholder="i18ns.t('relay.channelName')"
        @change="loadPoolMemberCandidates"
      />
      <el-radio-group v-model="poolMemberInsertPosition" size="small">
        <el-radio-button value="top">{{ i18ns.t('relay.poolMemberInsertTop') }}</el-radio-button>
        <el-radio-button value="bottom">{{
          i18ns.t('relay.poolMemberInsertBottom')
        }}</el-radio-button>
      </el-radio-group>
    </div>
    <el-table :data="poolMemberPickerRows" max-height="360" size="small">
      <el-table-column width="48"
        ><template #default="{ row }"
          ><el-checkbox v-model="selectedPoolMemberCandidateIds" :value="row.id" /></template
      ></el-table-column>
      <el-table-column prop="name" :label="i18ns.t('relay.channelName')" />
      <el-table-column :label="i18ns.t('relay.channelType')" width="180"
        ><template #default="{ row }">{{
          formatChannelTypeLabel(row.channelType)
        }}</template></el-table-column
      >
      <el-table-column :label="i18ns.t('status')" width="100"
        ><template #default="{ row }">{{
          row.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled')
        }}</template></el-table-column
      >
    </el-table>
    <el-pagination
      class="mt-3"
      small
      layout="prev, pager, next"
      :current-page="poolMemberPickerPagination.page"
      :page-size="poolMemberPickerPagination.pageSize"
      :total="poolMemberPickerPagination.total"
      @update:current-page="handlePoolMemberPickerPageChange"
    />
    <template #footer
      ><el-button @click="showPoolMemberPicker = false">{{ i18ns.t('cancel') }}</el-button
      ><el-button
        type="primary"
        :disabled="!selectedPoolMemberCandidateIds.length"
        @click="addSelectedPoolMembers"
        >{{ i18ns.t('confirm') }}</el-button
      ></template
    >
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

  <el-dialog
    v-model="showChannelDetailDialog"
    :title="channelDetailDialogTitle"
    :width="isDesktop ? '760px' : '92vw'"
    append-to-body
    destroy-on-close
    @closed="closeChannelDetailDialog"
  >
    <div v-if="currentChannelDetail" class="flex flex-col gap-5">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
          <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
            {{ i18ns.t('relay.channelName') }}
          </div>
          <div class="font-medium break-all">{{ currentChannelDetail.name || '-' }}</div>
        </div>
        <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
          <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
            {{ i18ns.t('status') }}
          </div>
          <el-tag :type="currentChannelDetail.enabled ? 'success' : 'info'" size="small">
            {{
              currentChannelDetail.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled')
            }}
          </el-tag>
        </div>
        <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
          <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
            {{ i18ns.t('relay.channelType') }}
          </div>
          <div>{{ formatChannelTypeLabel(currentChannelDetail.channelType) }}</div>
        </div>
        <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
          <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
            {{ i18ns.t('relay.visibilityMode') }}
          </div>
          <div>{{ getVisibilitySummary(currentChannelDetail) }}</div>
        </div>
        <div
          v-if="!['pooled', 'automatic-proxy-pool'].includes(currentChannelDetail.channelType)"
          class="rounded border border-[var(--el-border-color-lighter)] p-3"
        >
          <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
            {{ i18ns.t('relay.channelMultiplier') }}
          </div>
          <div>{{ currentChannelDetail.multiplier }}x</div>
        </div>
        <div
          v-if="!['pooled', 'automatic-proxy-pool'].includes(currentChannelDetail.channelType)"
          class="rounded border border-[var(--el-border-color-lighter)] p-3"
        >
          <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
            {{ i18ns.t('relay.inputTokensIncludeCacheRead') }}
          </div>
          <div>
            {{ currentChannelDetail.inputTokensIncludeCacheRead ? i18ns.t('yes') : i18ns.t('no') }}
          </div>
        </div>
        <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
          <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
            {{ i18ns.t('relay.createTime') }}
          </div>
          <div>{{ formatDateTime(currentChannelDetail.createTime) }}</div>
        </div>
        <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
          <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
            {{ i18ns.t('relay.updateTime') }}
          </div>
          <div>{{ formatDateTime(currentChannelDetail.updateTime) }}</div>
        </div>
      </div>

      <div>
        <el-divider content-position="left">{{ i18ns.t('relay.channelComposition') }}</el-divider>
        <div
          v-if="['pooled', 'automatic-proxy-pool'].includes(currentChannelDetail.channelType)"
          class="flex flex-col gap-3"
        >
          <div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mb-2">
              {{ i18ns.t('relay.routingStrategy') }}
            </div>
            <el-tag type="primary" size="small">
              {{ formatRoutingStrategyLabel(currentChannelDetail.routingStrategy) }}
            </el-tag>
          </div>
          <div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mb-2">
              {{ i18ns.t('relay.poolMembers') }}
            </div>
            <div v-if="(currentChannelDetail.poolMembers || []).length" class="flex flex-col gap-2">
              <div
                v-for="(member, index) in currentChannelDetail.poolMembers || []"
                :key="member.id || `${member.memberChannelId}-${index}`"
                class="rounded border border-[var(--el-border-color-lighter)] p-3"
              >
                <div class="font-medium break-all">
                  {{ getChannelNameById(member.memberChannelId) }}
                </div>
                <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
                  #{{ member.priority }}
                  <span v-if="typeof member.weight === 'number'"> · w={{ member.weight }}</span>
                  <span>
                    ·
                    {{
                      member.enabled === false
                        ? i18ns.t('relay.disabled')
                        : i18ns.t('relay.enabled')
                    }}</span
                  >
                </div>
              </div>
            </div>
            <el-empty v-else :description="i18ns.t('relay.noPoolMembers')" />
          </div>
          <div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mb-2">
              {{ i18ns.t('relay.routingConfig') }}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
                <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
                  {{ i18ns.t('relay.maxRetries') }}
                </div>
                <div>{{ formatNullableValue(currentChannelDetail.routingConfig?.maxRetries) }}</div>
              </div>
              <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
                <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
                  {{ i18ns.t('relay.failoverThreshold') }}
                </div>
                <div>
                  {{ formatNullableValue(currentChannelDetail.routingConfig?.failoverThreshold) }}
                </div>
              </div>
              <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
                <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
                  {{ i18ns.t('relay.failbackCooldownMinutes') }}
                </div>
                <div>
                  {{
                    formatNullableValue(currentChannelDetail.routingConfig?.failbackCooldownMinutes)
                  }}
                </div>
              </div>
              <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
                <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
                  {{ i18ns.t('relay.healthScoreThreshold') }}
                </div>
                <div>
                  {{
                    formatNullableValue(currentChannelDetail.routingConfig?.healthScoreThreshold)
                  }}
                </div>
              </div>
              <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
                <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
                  {{ i18ns.t('relay.latencyThresholdMs') }}
                </div>
                <div>
                  {{ formatNullableValue(currentChannelDetail.routingConfig?.latencyThresholdMs) }}
                </div>
              </div>
              <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
                <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
                  {{ i18ns.t('relay.circuitBreakerThreshold') }}
                </div>
                <div>
                  {{
                    formatNullableValue(currentChannelDetail.routingConfig?.circuitBreakerThreshold)
                  }}
                </div>
              </div>
              <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
                <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
                  {{ i18ns.t('relay.stickyByModel') }}
                </div>
                <div>
                  {{
                    currentChannelDetail.routingConfig?.stickyByModel
                      ? i18ns.t('yes')
                      : i18ns.t('no')
                  }}
                </div>
              </div>
              <div class="rounded border border-[var(--el-border-color-lighter)] p-3">
                <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
                  {{ i18ns.t('relay.stickyByFormat') }}
                </div>
                <div>
                  {{
                    currentChannelDetail.routingConfig?.stickyByFormat
                      ? i18ns.t('yes')
                      : i18ns.t('no')
                  }}
                </div>
              </div>
            </div>
            <div class="mt-3 rounded border border-[var(--el-border-color-lighter)] p-3">
              <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
                {{ i18ns.t('relay.retryStatusCodes') }}
              </div>
              <div>
                {{ formatStringList(currentChannelDetail.routingConfig?.retryStatusCodes) }}
              </div>
            </div>
          </div>
        </div>
        <el-alert
          v-else
          type="info"
          :closable="false"
          :title="formatChannelTypeLabel(currentChannelDetail.channelType)"
        />
      </div>

      <div>
        <el-divider content-position="left">{{
          i18ns.t('relay.formatAndModelRestrictions')
        }}</el-divider>
        <div class="flex flex-col gap-3">
          <div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mb-2">
              {{ i18ns.t('relay.supportedFormats') }}
            </div>
            <div class="flex flex-wrap gap-2">
              <template v-if="currentChannelDetail.allowedFormats === 'all'">
                <el-tag type="success" size="small">OpenAI</el-tag>
                <el-tag type="warning" size="small">Anthropic</el-tag>
                <el-tag type="primary" size="small">Gemini</el-tag>
              </template>
              <template v-else>
                <el-tag
                  v-if="currentChannelDetail.allowedFormats.includes('openai')"
                  type="success"
                  size="small"
                  >OpenAI</el-tag
                >
                <el-tag
                  v-if="currentChannelDetail.allowedFormats.includes('anthropic')"
                  type="warning"
                  size="small"
                  >Anthropic</el-tag
                >
                <el-tag
                  v-if="currentChannelDetail.allowedFormats.includes('gemini')"
                  type="primary"
                  size="small"
                  >Gemini</el-tag
                >
              </template>
            </div>
          </div>
          <div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mb-2">
              {{ i18ns.t('relay.allowedModelsChannel') }}
            </div>
            <div class="flex flex-wrap gap-2">
              <template v-if="currentChannelDetail.allowedModels.length">
                <el-tag
                  v-for="model in currentChannelDetail.allowedModels"
                  :key="model"
                  type="primary"
                  size="small"
                  >{{ model }}</el-tag
                >
              </template>
              <el-tag v-else type="danger" size="small">{{ i18ns.t('relay.noModels') }}</el-tag>
            </div>
            <div
              v-if="['pooled', 'automatic-proxy-pool'].includes(currentChannelDetail.channelType)"
              class="mt-2 text-xs text-[var(--el-text-color-secondary)]"
            >
              {{ formatAllowedModelsModeLabel(getChannelAllowedModelsMode(currentChannelDetail)) }}
            </div>
          </div>
        </div>
      </div>

      <div>
        <el-divider content-position="left">{{ i18ns.t('relay.upstreamConfig') }}</el-divider>
        <div
          v-if="!['pooled', 'automatic-proxy-pool'].includes(currentChannelDetail.channelType)"
          class="grid grid-cols-1 gap-3"
        >
          <div
            v-if="computeShowUpstream(currentChannelDetail.allowedFormats, 'openai')"
            class="rounded border border-[var(--el-border-color-lighter)] p-3"
          >
            <div class="flex items-center gap-2 mb-2">
              <el-tag type="success" size="small">OpenAI</el-tag>
            </div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">URL</div>
            <div class="break-all mb-3">{{ currentChannelDetail.openaiUpstreamUrl || '-' }}</div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
              {{ i18ns.t('relay.apiKeyConfigured') }}
            </div>
            <div>
              {{
                currentChannelDetail.hasOpenaiUpstreamApiKey
                  ? i18ns.t('yes')
                  : i18ns.t('relay.notConfigured')
              }}
            </div>
          </div>
          <div
            v-if="computeShowUpstream(currentChannelDetail.allowedFormats, 'anthropic')"
            class="rounded border border-[var(--el-border-color-lighter)] p-3"
          >
            <div class="flex items-center gap-2 mb-2">
              <el-tag type="warning" size="small">Anthropic</el-tag>
            </div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">URL</div>
            <div class="break-all mb-3">{{ currentChannelDetail.anthropicUpstreamUrl || '-' }}</div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
              {{ i18ns.t('relay.apiKeyConfigured') }}
            </div>
            <div>
              {{
                currentChannelDetail.hasAnthropicUpstreamApiKey
                  ? i18ns.t('yes')
                  : i18ns.t('relay.notConfigured')
              }}
            </div>
          </div>
          <div
            v-if="computeShowUpstream(currentChannelDetail.allowedFormats, 'gemini')"
            class="rounded border border-[var(--el-border-color-lighter)] p-3"
          >
            <div class="flex items-center gap-2 mb-2">
              <el-tag type="primary" size="small">Gemini</el-tag>
            </div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">URL</div>
            <div class="break-all mb-3">{{ currentChannelDetail.geminiUpstreamUrl || '-' }}</div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mb-1">
              {{ i18ns.t('relay.apiKeyConfigured') }}
            </div>
            <div>
              {{
                currentChannelDetail.hasGeminiUpstreamApiKey
                  ? i18ns.t('yes')
                  : i18ns.t('relay.notConfigured')
              }}
            </div>
          </div>
        </div>
        <el-alert
          v-else
          type="info"
          :closable="false"
          :title="i18ns.t('relay.pooledNoDirectUpstreamHelp')"
        />
      </div>

      <div>
        <el-divider content-position="left">{{ i18ns.t('relay.modelMappingSection') }}</el-divider>
        <div
          v-if="getModelMappingEntries(currentChannelDetail.modelMapping).length"
          class="flex flex-col gap-2"
        >
          <div
            v-for="([sourceModel, targetModel], index) in getModelMappingEntries(
              currentChannelDetail.modelMapping,
            )"
            :key="`${sourceModel}-${targetModel}-${index}`"
            class="rounded border border-[var(--el-border-color-lighter)] p-3 flex items-center justify-between gap-3"
          >
            <span class="break-all">{{ sourceModel }}</span>
            <span class="text-[var(--el-text-color-secondary)]">-></span>
            <span class="break-all text-right">{{ targetModel }}</span>
          </div>
        </div>
        <el-empty v-else :description="i18ns.t('relay.modelMappingEmpty')" />
      </div>

      <div v-if="!['pooled', 'automatic-proxy-pool'].includes(currentChannelDetail.channelType)">
        <el-divider content-position="left">{{ i18ns.t('relay.timeRules') }}</el-divider>
        <div
          v-if="(currentChannelDetail.timePeriodMultipliers || []).length"
          class="flex flex-col gap-2"
        >
          <div
            v-for="(rule, index) in currentChannelDetail.timePeriodMultipliers || []"
            :key="`${rule.name}-${index}`"
            class="rounded border border-[var(--el-border-color-lighter)] p-3"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="font-medium break-all">{{ rule.name }}</div>
              <el-tag :type="rule.multiplier >= 1 ? 'warning' : 'success'" size="small"
                >{{ rule.multiplier }}x</el-tag
              >
            </div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
              {{ formatTimeRuleDays(rule.dayOfWeek) }} · {{ rule.startTime }} - {{ rule.endTime }}
            </div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
              {{ rule.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled') }}
            </div>
          </div>
        </div>
        <el-empty v-else :description="i18ns.t('relay.timeRulesEmpty')" />
      </div>
    </div>
    <template #footer>
      <el-button @click="closeChannelDetailDialog">{{ i18ns.t('confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Delete, Rank, Top } from '@element-plus/icons-vue'
import Sortable from 'sortablejs'
import ModelMappingEditor from '@/components/relay/ModelMappingEditor.vue'
import { i18ns } from '@/locales'
import { useRelaySettingsManagementContext } from '../context'

const state = useRelaySettingsManagementContext()

const {
  isDesktop,
  showChannelDialog,
  isEditingChannel,
  channelForm,
  showChannelDetailDialog,
  currentChannelDetail,
  visibilityUserOptions,
  visibilityGroupOptions,
  visibilityRoleOptions,
  visibilityUserOptionsLoading,
  visibilityGroupOptionsLoading,
  visibilityRoleOptionsLoading,
  filteredModels,
  formatModelOptionLabel,
  isModelDisabled,
  computeShowUpstream,
  getChannelNameById,
  showPoolMemberPicker,
  poolMemberPickerRows,
  poolMemberPickerPagination,
  poolMemberPickerKeyword,
  selectedPoolMemberCandidateIds,
  poolMemberInsertPosition,
  openPoolMemberPicker,
  loadPoolMemberCandidates,
  addSelectedPoolMembers,
  movePoolMember,
  movePoolMemberToEdge,
  removePoolMember,
  filteredModelNames,
  openAddTimeRule,
  formatTimeRuleDays,
  openEditTimeRule,
  removeTimeRule,
  channelSaving,
  handleSaveChannel,
  resetRoutingConfigToRecommended,
  clearOptionalRoutingThresholds,
  formatChannelTypeLabel,
  formatRoutingStrategyLabel,
  getVisibilitySummary,
  showChannelImportDialog,
  channelImportText,
  channelImportPlaceholder,
  closeChannelDetailDialog,
  handleVisibilityUserSearch,
  getChannelAllowedModelsMode,
  handleImportChannels,
} = state

const handlePoolMemberPickerPageChange = (page: number) => {
  poolMemberPickerPagination.value.page = page
  void loadPoolMemberCandidates()
}

const poolMemberSortableRef = ref<HTMLElement>()
let poolMemberSortable: Sortable | null = null

const destroyPoolMemberSortable = () => {
  poolMemberSortable?.destroy()
  poolMemberSortable = null
}

const initPoolMemberSortable = async () => {
  await nextTick()
  destroyPoolMemberSortable()
  if (!poolMemberSortableRef.value) return
  poolMemberSortable = new Sortable(poolMemberSortableRef.value, {
    animation: 150,
    handle: '.relay-pool-member-row__drag',
    draggable: '.relay-pool-member-row',
    onEnd: (event) => movePoolMember(event.oldIndex ?? -1, event.newIndex ?? -1),
  })
}

watch(showChannelDialog, (visible) => {
  if (visible) void initPoolMemberSortable()
  else destroyPoolMemberSortable()
})

onBeforeUnmount(destroyPoolMemberSortable)

const formatVisibilityUserOption = (user: {
  username: string
  name: string | null
  id: string
}) => {
  const primary = user.name?.trim() || user.username || user.id
  if (primary === user.id) return user.id
  return `${primary} (${user.id})`
}

const formatVisibilityGroupOption = (group: { name: string; username: string; id: string }) => {
  const primary = group.name?.trim() || group.username || group.id
  if (primary === group.id) return group.id
  return `${primary} (${group.id})`
}

const formatVisibilityRoleOption = (role: { name: string; id: string }) => {
  if (!role.name || role.name === role.id) return role.id
  return `${role.name} (${role.id})`
}

const channelDetailDialogTitle = computed(() => {
  if (!currentChannelDetail.value) return i18ns.t('relay.channelDetailsTitle')
  return `${i18ns.t('relay.channelDetailsTitle')} · ${currentChannelDetail.value.name}`
})

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

const formatNullableValue = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

const formatStringList = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0) return '-'
  return value.join(', ')
}

const formatAllowedModelsModeLabel = (mode: 'all' | 'manual' | 'auto') => {
  switch (mode) {
    case 'auto':
      return i18ns.t('relay.allowedModelsModeAuto')
    case 'manual':
      return i18ns.t('relay.allowedModelsModeManual')
    case 'all':
    default:
      return i18ns.t('relay.allowedModelsModeAll')
  }
}

const getModelMappingEntries = (value: unknown): Array<[string, string]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, string>).filter(
    ([sourceModel, targetModel]) => sourceModel.trim() !== '' && String(targetModel).trim() !== '',
  )
}
</script>
