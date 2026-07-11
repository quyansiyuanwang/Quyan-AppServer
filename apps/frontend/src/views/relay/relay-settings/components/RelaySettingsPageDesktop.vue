<template>
  <div class="desktop-page">
    <div class="relay-settings-desktop-stack">
      <div class="relay-settings relay-settings-desktop" v-loading="loading">
        <el-collapse v-model="desktopSections">
          <el-collapse-item name="basic">
            <template #title>
              <span class="collapse-title">{{ i18ns.t('nav.relaySettings') }}</span>
            </template>
            <el-form label-width="200px" label-position="right">
              <el-form-item :label="i18ns.t('ServerConfigView.globalMultiplier')">
                <el-input-number v-model="globalMultiplier" :step="0.000001" :precision="6" />
                <span class="form-help">{{ i18ns.t('ServerConfigView.globalMultiplierHelp') }}</span>
              </el-form-item>
            </el-form>
          </el-collapse-item>

          <el-collapse-item name="monitor">
            <template #title>
              <span class="collapse-title">{{ i18ns.t('relay.monitorConfig') }}</span>
            </template>
            <el-form label-width="200px" label-position="right">
              <el-form-item :label="i18ns.t('relay.uptimeStatusUrl')">
                <el-input
                  v-model="uptimeStatusUrl"
                  placeholder="https://example.com/api/uptime/status"
                  clearable
                />
                <span class="form-help">{{ i18ns.t('relay.uptimeStatusUrlHelp') }}</span>
              </el-form-item>
              <el-form-item :label="i18ns.t('relay.monitorConfig')" class="block-form-item">
                <div style="width: 100%">
                  <el-switch v-model="monitorConfigEnabled" />
                  <span class="form-help">{{ i18ns.t('relay.monitorConfigHelp') }}</span>
                  <div v-if="monitorConfigEnabled" style="margin-top: 12px">
                    <el-alert type="info" :closable="false" style="margin-bottom: 12px">
                      <template #default>
                        <div style="font-size: 13px">
                          <div style="margin-bottom: 4px">
                            <strong>{{
                              i18ns.t('ServerConfigView.monitorConfigDescription')
                            }}</strong>
                          </div>
                          <div style="color: #909399">
                            {{ i18ns.t('ServerConfigView.monitorIdFormat') }}
                          </div>
                        </div>
                      </template>
                    </el-alert>
                    <el-checkbox v-model="showOnlyConfigured" style="margin-bottom: 12px">
                      {{ i18ns.t('ServerConfigView.showOnlyConfigured') }}
                    </el-checkbox>
                    <el-table :data="monitorConfigs" border size="small">
                      <el-table-column :label="i18ns.t('ServerConfigView.monitorId')" width="120">
                        <template #default="{ row }">
                          <el-input
                            v-model="row.monitorId"
                            size="small"
                            placeholder="2"
                            @input="row.monitorId = row.monitorId.replace(/[^0-9]/g, '')"
                          />
                        </template>
                      </el-table-column>
                      <el-table-column
                        :label="i18ns.t('ServerConfigView.monitorDisplayName')"
                        min-width="200"
                      >
                        <template #default="{ row }">
                          <el-input
                            v-model="row.displayName"
                            size="small"
                            :placeholder="i18ns.t('ServerConfigView.monitorDisplayNamePlaceholder')"
                          />
                        </template>
                      </el-table-column>
                      <el-table-column width="80">
                        <template #default="{ $index }">
                          <el-button
                            type="danger"
                            link
                            size="small"
                            @click="monitorConfigs.splice($index, 1)"
                          >
                            {{ i18ns.t('delete') }}
                          </el-button>
                        </template>
                      </el-table-column>
                    </el-table>
                    <el-button size="small" style="margin-top: 8px" @click="addMonitorConfig">
                      {{ i18ns.t('relay.addMonitorConfig') }}
                    </el-button>
                  </div>
                </div>
              </el-form-item>
            </el-form>
          </el-collapse-item>

        <el-collapse-item name="queue">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.requestQueueTitle') }}</span>
          </template>
          <el-alert type="info" :closable="false" style="margin-bottom: 16px">
            {{ i18ns.t('ServerConfigView.imageScopeNotice') }}
          </el-alert>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.enableQueue')">
              <el-switch v-model="enableQueue" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.enableQueueHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.maxConcurrency')">
              <el-input-number
                v-model="maxConcurrency"
                :min="1"
                :max="100"
                :step="1"
                :precision="0"
              />
              <span class="form-help">{{ i18ns.t('ServerConfigView.maxConcurrencyHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.queueTimeout')">
              <el-input-number v-model="queueTimeoutSec" :min="0" :step="1" :precision="0" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.queueTimeoutHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.upstreamStreamTimeout')">
              <el-input-number
                v-model="upstreamStreamTimeoutSec"
                :min="0"
                :step="1"
                :precision="0"
              />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.upstreamStreamTimeoutHelp')
              }}</span>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="customKey">
          <template #title>
            <span class="collapse-title">{{
              i18ns.t('ServerConfigView.relayCustomKeyTitle')
            }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.relayCustomKeyEnabled')">
              <el-switch v-model="relayCustomKeyEnabled" />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.relayCustomKeyEnabledHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.relayCustomKeyMaxTokensPerUser')">
              <el-input-number
                v-model="relayCustomKeyMaxTokensPerUser"
                :min="0"
                :max="1000"
                :disabled="!relayCustomKeyEnabled"
              />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.relayCustomKeyMaxTokensPerUserHelp')
              }}</span>
            </el-form-item>
            <el-form-item
              :label="i18ns.t('ServerConfigView.relayCustomKeyCreateLimitWindowMinutes')"
            >
              <el-input-number
                v-model="relayCustomKeyCreateLimitWindowMinutes"
                :min="1"
                :max="525600"
                :disabled="!relayCustomKeyEnabled"
              />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.relayCustomKeyCreateLimitWindowMinutesHelp')
              }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('ServerConfigView.relayCustomKeyCreateLimitMaxCount')">
              <el-input-number
                v-model="relayCustomKeyCreateLimitMaxCount"
                :min="0"
                :max="100000"
                :disabled="!relayCustomKeyEnabled"
              />
              <span class="form-help">{{
                i18ns.t('ServerConfigView.relayCustomKeyCreateLimitMaxCountHelp')
              }}</span>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item name="pricing">
          <template #title>
            <span class="collapse-title">{{
              i18ns.t('ServerConfigView.allowedModelsAndPricing')
            }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item
              :label="i18ns.t('ServerConfigView.allowedModelsAndPricing')"
              class="block-form-item"
            >
              <div style="width: 100%">
                <div style="margin-bottom: 8px; display: flex; gap: 8px; flex-wrap: wrap">
                  <el-button size="small" @click="exportModelPricing">{{
                    i18ns.t('ServerConfigView.exportPricing')
                  }}</el-button>
                  <el-button size="small" @click="copyModelPricing">{{
                    i18ns.t('ServerConfigView.copyPricing')
                  }}</el-button>
                  <el-button size="small" @click="showImportDialog = true">{{
                    i18ns.t('ServerConfigView.importPricing')
                  }}</el-button>
                </div>
                <el-table
                  :data="modelRates"
                  border
                  size="small"
                  :row-key="getModelRateRowKey"
                  :row-class-name="
                    ({ rowIndex }: { rowIndex: number }) =>
                      rowIndex === editingRowIndex ? 'editing-row' : ''
                  "
                  @row-click="(row: any) => (editingRowIndex = modelRates.indexOf(row))"
                >
                  <el-table-column :label="i18ns.t('ServerConfigView.modelName')" width="200">
                    <template #default="{ row, $index }">
                      <el-input
                        v-if="editingRowIndex === $index"
                        v-model="row.model"
                        size="small"
                        :placeholder="i18ns.t('ServerConfigView.modelNamePlaceholder')"
                      />
                      <span v-else style="cursor: pointer">{{ row.model || '-' }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column :label="i18ns.t('ServerConfigView.modelId')" width="200">
                    <template #default="{ row, $index }">
                      <el-input
                        v-if="editingRowIndex === $index"
                        v-model="row.modelId"
                        size="small"
                        :placeholder="i18ns.t('ServerConfigView.modelIdPlaceholder')"
                      />
                      <span v-else style="cursor: pointer">{{
                        row.modelId || row.model || '-'
                      }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column :label="i18ns.t('ServerConfigView.pricingType')" width="130">
                    <template #default="{ row, $index }">
                      <el-select
                        v-if="editingRowIndex === $index"
                        v-model="row.pricingType"
                        size="small"
                        style="width: 100%"
                      >
                        <el-option
                          :label="i18ns.t('ServerConfigView.pricingTypeTokenBased')"
                          value="token-based"
                        />
                        <el-option
                          :label="i18ns.t('ServerConfigView.pricingTypePerRequest')"
                          value="per-request"
                        />
                      </el-select>
                      <span v-else style="cursor: pointer">{{
                        row.pricingType === 'per-request'
                          ? i18ns.t('ServerConfigView.pricingTypePerRequest')
                          : i18ns.t('ServerConfigView.pricingTypeTokenBased')
                      }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column
                    :label="i18ns.t('ServerConfigView.supportedFormats')"
                    width="180"
                    class-name="hide-on-mobile"
                  >
                    <template #default="{ row, $index }">
                      <el-select
                        v-if="editingRowIndex === $index"
                        v-model="row.supportedFormats"
                        size="small"
                        :placeholder="i18ns.t('ServerConfigView.selectFormat')"
                        multiple
                        collapse-tags
                        collapse-tags-tooltip
                        :max-collapse-tags="2"
                        style="width: 100%"
                      >
                        <el-option label="OpenAI" value="openai" />
                        <el-option label="Anthropic" value="anthropic" />
                        <el-option label="Gemini" value="gemini" />
                      </el-select>
                      <span v-else style="cursor: pointer">{{
                        Array.isArray(row.supportedFormats) && row.supportedFormats.length
                          ? row.supportedFormats.join(', ')
                          : 'All'
                      }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column
                    :label="i18ns.t('ServerConfigView.fixedPrice')"
                    width="120"
                    class-name="hide-on-mobile"
                  >
                    <template #default="{ row, $index }">
                      <el-input-number
                        v-if="editingRowIndex === $index && row.pricingType === 'per-request'"
                        v-model="row.fixedPrice"
                        :step="0.01"
                        :precision="4"
                        size="small"
                        style="width: 100%"
                      />
                      <span v-else-if="row.pricingType === 'per-request'" style="cursor: pointer">{{
                        row.fixedPrice
                      }}</span>
                      <span v-else style="color: #909399; font-size: 12px">-</span>
                    </template>
                  </el-table-column>
                  <el-table-column
                    :label="i18ns.t('ServerConfigView.inputPricePerMillion')"
                    width="120"
                  >
                    <template #default="{ row, $index }">
                      <el-input-number
                        v-if="editingRowIndex === $index && row.pricingType === 'token-based'"
                        v-model="row.inputPrice"
                        :step="0.01"
                        :precision="6"
                        size="small"
                        style="width: 100%"
                      />
                      <span v-else-if="row.pricingType === 'token-based'" style="cursor: pointer">{{
                        row.inputPrice
                      }}</span>
                      <span v-else style="color: #909399; font-size: 12px">-</span>
                    </template>
                  </el-table-column>
                  <el-table-column
                    :label="i18ns.t('ServerConfigView.outputPricePerMillion')"
                    width="120"
                  >
                    <template #default="{ row, $index }">
                      <el-input-number
                        v-if="editingRowIndex === $index && row.pricingType === 'token-based'"
                        v-model="row.outputPrice"
                        :step="0.01"
                        :precision="6"
                        size="small"
                        style="width: 100%"
                      />
                      <span v-else-if="row.pricingType === 'token-based'" style="cursor: pointer">{{
                        row.outputPrice
                      }}</span>
                      <span v-else style="color: #909399; font-size: 12px">-</span>
                    </template>
                  </el-table-column>
                  <el-table-column
                    :label="i18ns.t('ServerConfigView.cacheCreationMultiplier')"
                    width="110"
                    class-name="hide-on-mobile"
                  >
                    <template #default="{ row, $index }">
                      <el-input-number
                        v-if="editingRowIndex === $index && row.pricingType === 'token-based'"
                        v-model="row.cacheCreationMultiplier"
                        :step="0.01"
                        :precision="2"
                        size="small"
                        style="width: 100%"
                      />
                      <span v-else-if="row.pricingType === 'token-based'" style="cursor: pointer">{{
                        row.cacheCreationMultiplier
                      }}</span>
                      <span v-else style="color: #909399; font-size: 12px">-</span>
                    </template>
                  </el-table-column>
                  <el-table-column
                    :label="i18ns.t('ServerConfigView.cacheReadMultiplier')"
                    width="110"
                    class-name="hide-on-mobile"
                  >
                    <template #default="{ row, $index }">
                      <el-input-number
                        v-if="editingRowIndex === $index && row.pricingType === 'token-based'"
                        v-model="row.cacheReadMultiplier"
                        :step="0.01"
                        :precision="2"
                        size="small"
                        style="width: 100%"
                      />
                      <span v-else-if="row.pricingType === 'token-based'" style="cursor: pointer">{{
                        row.cacheReadMultiplier
                      }}</span>
                      <span v-else style="color: #909399; font-size: 12px">-</span>
                    </template>
                  </el-table-column>
                  <el-table-column :label="i18ns.t('actions')" min-width="80">
                    <template #default="{ $index }">
                      <el-button
                        type="danger"
                        link
                        size="small"
                        @click.stop="
                          () => {
                            modelRates.splice($index, 1)
                            if (editingRowIndex === $index) editingRowIndex = null
                          }
                        "
                      >
                        {{ i18ns.t('delete') }}
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>
                <el-button size="small" style="margin-top: 8px" @click="addModelRate">{{
                  i18ns.t('ServerConfigView.addModel')
                }}</el-button>
                <span class="form-help">{{ i18ns.t('ServerConfigView.modelPricingHelp') }}</span>
              </div>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        </el-collapse>

        <div class="relay-settings-save-bar">
          <el-button type="primary" :loading="saving" @click="save">{{ i18ns.t('save') }}</el-button>
        </div>
      </div>

      <el-dialog
        v-model="showImportDialog"
        :title="i18ns.t('ServerConfigView.importPricing')"
        width="600px"
        append-to-body
      >
        <el-input
          v-model="importText"
          type="textarea"
          :rows="12"
          :placeholder="importPricingPlaceholder"
        />
        <template #footer>
          <el-button @click="showImportDialog = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" @click="handleImport">{{ i18ns.t('confirm') }}</el-button>
        </template>
      </el-dialog>

      <div class="relay-settings relay-settings-desktop" v-loading="channelLoading">
        <el-collapse v-model="desktopSections">
          <el-collapse-item name="channels">
            <template #title>
              <span class="collapse-title">{{ i18ns.t('relay.channelManagement') }}</span>
            </template>
            <div class="flex flex-col gap-3 mb-3">
              <div class="flex flex-wrap items-center gap-2">
                <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                  <el-button type="primary" size="small" @click="openCreateChannelDialog">{{
                    i18ns.t('relay.createChannel')
                  }}</el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                  <el-button size="small" @click="openChannelImportDialog">{{
                    i18ns.t('relay.importChannels')
                  }}</el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_CHANNEL_READ]">
                  <el-button size="small" @click="exportChannelsAsJson">{{
                    i18ns.t('relay.exportChannels')
                  }}</el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_CHANNEL_READ]">
                  <el-button size="small" @click="copyChannelsAsJson">{{
                    i18ns.t('relay.copyChannels')
                  }}</el-button>
                </PermissionWrapper>
              </div>
              <div class="flex flex-wrap items-center gap-2 justify-between">
                <div class="flex flex-wrap items-center gap-2">
                  <el-tag v-if="selectedChannels.length" type="info" size="small">
                    {{ i18ns.t('relay.selectedChannels', { count: selectedChannels.length }) }}
                  </el-tag>
                  <el-checkbox :model-value="isAllChannelsSelected" @change="toggleAllChannels">
                    {{ i18ns.t('relay.selectAllChannels') }}
                  </el-checkbox>
                  <el-button
                    text
                    size="small"
                    :disabled="!hasChannelSelection"
                    @click="clearChannelSelection"
                  >
                    {{ i18ns.t('relay.clearChannelSelection') }}
                  </el-button>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                    <el-button
                      size="small"
                      :disabled="!hasChannelSelection"
                      @click="handleBatchDuplicateChannels"
                      >{{ i18ns.t('relay.batchDuplicateChannels') }}</el-button
                    >
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_READ]">
                    <el-button
                      size="small"
                      :disabled="!hasChannelSelection"
                      @click="exportChannelsAsJson"
                      >{{ i18ns.t('relay.batchExportChannels') }}</el-button
                    >
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_UPDATE]">
                    <el-button
                      size="small"
                      type="success"
                      :disabled="!hasChannelSelection"
                      @click="handleBatchSetChannelStatus(true)"
                      >{{ i18ns.t('relay.batchEnableChannels') }}</el-button
                    >
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_UPDATE]">
                    <el-button
                      size="small"
                      type="warning"
                      :disabled="!hasChannelSelection"
                      @click="handleBatchSetChannelStatus(false)"
                      >{{ i18ns.t('relay.batchDisableChannels') }}</el-button
                    >
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_DELETE]">
                    <el-button
                      size="small"
                      type="danger"
                      :disabled="!hasChannelSelection"
                      @click="handleBatchDeleteChannels"
                      >{{ i18ns.t('relay.batchDeleteChannels') }}</el-button
                    >
                  </PermissionWrapper>
                </div>
              </div>
            </div>
            <el-table :data="channels" style="width: 100%" size="small" row-key="id">
              <el-table-column width="58" align="center">
                <template #header>
                  <el-checkbox :model-value="isAllChannelsSelected" @change="toggleAllChannels" />
                </template>
                <template #default="{ row }">
                  <el-checkbox
                    :model-value="isChannelSelected(row.id)"
                    @change="toggleChannelSelection(row.id, $event)"
                  />
                </template>
              </el-table-column>
              <el-table-column prop="name" :label="i18ns.t('relay.channelName')" min-width="120" />
              <el-table-column
                :label="i18ns.t('relay.supportedFormats')"
                width="180"
                class-name="hide-on-mobile"
              >
                <template #default="{ row }">
                  <div style="display: flex; gap: 4px; flex-wrap: wrap">
                    <template v-if="row.allowedFormats === 'all'">
                      <el-tag type="success" size="small">OpenAI</el-tag>
                      <el-tag type="warning" size="small">Anthropic</el-tag>
                      <el-tag type="primary" size="small">Gemini</el-tag>
                    </template>
                    <template v-else>
                      <el-tag v-if="row.allowedFormats.includes('openai')" type="success" size="small"
                        >OpenAI</el-tag
                      >
                      <el-tag
                        v-if="row.allowedFormats.includes('anthropic')"
                        type="warning"
                        size="small"
                        >Anthropic</el-tag
                      >
                      <el-tag v-if="row.allowedFormats.includes('gemini')" type="primary" size="small"
                        >Gemini</el-tag
                      >
                    </template>
                  </div>
                </template>
              </el-table-column>
              <el-table-column
                :label="i18ns.t('relay.upstreamConfig')"
                min-width="200"
                class-name="hide-on-mobile"
              >
                <template #default="{ row }">
                  <div style="font-size: 12px">
                    <div
                      v-if="computeShowUpstream(row.allowedFormats.split(','), 'openai')"
                      style="margin-top: 4px"
                    >
                      <el-tag size="small" type="success">OpenAI</el-tag>
                      <span style="margin-left: 4px; word-break: break-all">{{
                        row.openaiUpstreamUrl
                      }}</span>
                    </div>
                    <div
                      v-if="computeShowUpstream(row.allowedFormats.split(','), 'anthropic')"
                      style="margin-top: 4px"
                    >
                      <el-tag size="small" type="warning">Anthropic</el-tag>
                      <span style="margin-left: 4px; word-break: break-all">{{
                        row.anthropicUpstreamUrl
                      }}</span>
                    </div>
                    <div
                      v-if="computeShowUpstream(row.allowedFormats.split(','), 'gemini')"
                      style="margin-top: 4px"
                    >
                      <el-tag size="small" type="primary">Gemini</el-tag>
                      <span style="margin-left: 4px; word-break: break-all">{{
                        row.geminiUpstreamUrl
                      }}</span>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('relay.allowedModelsChannel')" width="120">
                <template #default="{ row }">
                  <el-tag v-if="!row.allowedModels" type="info" size="small">{{
                    i18ns.t('relay.allModels')
                  }}</el-tag>
                  <el-tag
                    v-else-if="parseAllowedModels(row.allowedModels).length === 0"
                    type="danger"
                    size="small"
                    >{{ i18ns.t('relay.noModels') }}</el-tag
                  >
                  <el-tooltip
                    v-else
                    :content="parseAllowedModels(row.allowedModels).join(', ')"
                    placement="top"
                  >
                    <el-tag type="primary" size="small">
                      {{ parseAllowedModels(row.allowedModels).length }}
                      {{ i18ns.t('relay.modelsCount') }}
                    </el-tag>
                  </el-tooltip>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('status')" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{
                    row.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled')
                  }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="i18ns.t('relay.channelMultiplier')" width="100">
                <template #default="{ row }">{{ row.multiplier }}x</template>
              </el-table-column>
              <el-table-column
                :label="i18ns.t('relay.createTime')"
                width="170"
                class-name="hide-on-mobile"
              >
                <template #default="{ row }">{{
                  new Date(row.createTime).toLocaleString()
                }}</template>
              </el-table-column>
              <el-table-column :label="i18ns.t('actions')" width="360" fixed="right">
                <template #default="{ row }">
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_UPDATE]">
                    <el-button
                      size="small"
                      :type="row.enabled ? 'warning' : 'success'"
                      :loading="togglingChannelId === row.id"
                      @click="handleToggleChannelStatus(row)"
                    >
                      {{ row.enabled ? i18ns.t('relay.disable') : i18ns.t('relay.enable') }}
                    </el-button>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_UPDATE]">
                    <el-button size="small" @click="openEditChannelDialog(row)">{{
                      i18ns.t('edit')
                    }}</el-button>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                    <el-button size="small" @click="handleDuplicateChannel(row)">{{
                      i18ns.t('relay.duplicateChannel')
                    }}</el-button>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_DELETE]">
                    <el-button size="small" type="danger" @click="handleDeleteChannel(row)">{{
                      i18ns.t('delete')
                    }}</el-button>
                  </PermissionWrapper>
                </template>
              </el-table-column>
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { i18ns } from '@/locales'
import { useRelaySettingsManagementContext } from '../context'

const state = useRelaySettingsManagementContext()

const {
  Permission,
  loading,
  desktopSections,
  globalMultiplier,
  uptimeStatusUrl,
  monitorConfigEnabled,
  showOnlyConfigured,
  monitorConfigs,
  addMonitorConfig,
  enableQueue,
  maxConcurrency,
  queueTimeoutSec,
  upstreamStreamTimeoutSec,
  relayCustomKeyEnabled,
  relayCustomKeyMaxTokensPerUser,
  relayCustomKeyCreateLimitWindowMinutes,
  relayCustomKeyCreateLimitMaxCount,
  exportModelPricing,
  copyModelPricing,
  showImportDialog,
  modelRates,
  getModelRateRowKey,
  editingRowIndex,
  addModelRate,
  saving,
  save,
  importText,
  importPricingPlaceholder,
  handleImport,
  channelLoading,
  openCreateChannelDialog,
  openChannelImportDialog,
  exportChannelsAsJson,
  copyChannelsAsJson,
  selectedChannels,
  isAllChannelsSelected,
  toggleAllChannels,
  hasChannelSelection,
  clearChannelSelection,
  handleBatchDuplicateChannels,
  handleBatchSetChannelStatus,
  handleBatchDeleteChannels,
  channels,
  isChannelSelected,
  toggleChannelSelection,
  computeShowUpstream,
  parseAllowedModels,
  togglingChannelId,
  handleToggleChannelStatus,
  openEditChannelDialog,
  handleDuplicateChannel,
  handleDeleteChannel,
} = state
</script>
