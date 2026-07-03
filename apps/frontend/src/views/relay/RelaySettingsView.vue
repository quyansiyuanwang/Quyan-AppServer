<template>
  <div v-if="isDesktop" class="desktop-page">
    <div class="relay-settings relay-settings-desktop" v-loading="loading">
      <el-collapse v-model="desktopSections">
        <!-- Basic Settings -->
        <el-collapse-item name="basic">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('nav.relaySettings') }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.globalMultiplier')">
              <el-input-number v-model="globalMultiplier" :step="0.000001" :precision="6" />
              <span class="form-help">{{ i18ns.t('ServerConfigView.globalMultiplierHelp') }}</span>
            </el-form-item>
            <el-form-item :label="i18ns.t('relay.uptimeStatusUrl')">
              <el-input
                v-model="uptimeStatusUrl"
                placeholder="https://example.com/api/uptime/status"
                clearable
              />
              <span class="form-help">{{ i18ns.t('relay.uptimeStatusUrlHelp') }}</span>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <!-- Monitor Config -->
        <el-collapse-item name="monitor">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('relay.monitorConfig') }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('relay.monitorConfig')">
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

        <!-- Queue Settings -->
        <el-collapse-item name="queue">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('ServerConfigView.enableQueue') }}</span>
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

        <!-- Pricing -->
        <el-collapse-item name="pricing">
          <template #title>
            <span class="collapse-title">{{
              i18ns.t('ServerConfigView.allowedModelsAndPricing')
            }}</span>
          </template>
          <el-form label-width="200px" label-position="right">
            <el-form-item :label="i18ns.t('ServerConfigView.allowedModelsAndPricing')">
              <div style="width: 100%">
                <div style="margin-bottom: 8px; display: flex; gap: 8px; flex-wrap: wrap">
                  <el-button size="small" @click="exportModelPricing">
                    {{ i18ns.t('ServerConfigView.exportPricing') }}
                  </el-button>
                  <el-button size="small" @click="copyModelPricing">
                    {{ i18ns.t('ServerConfigView.copyPricing') }}
                  </el-button>
                  <el-button size="small" @click="showImportDialog = true">
                    {{ i18ns.t('ServerConfigView.importPricing') }}
                  </el-button>
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
                <el-button size="small" style="margin-top: 8px" @click="addModelRate">
                  {{ i18ns.t('ServerConfigView.addModel') }}
                </el-button>
                <span class="form-help">{{ i18ns.t('ServerConfigView.modelPricingHelp') }}</span>
              </div>
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>

      <div class="relay-settings-save-bar">
        <el-button type="primary" :loading="saving" @click="save">
          {{ i18ns.t('save') }}
        </el-button>
      </div>

      <!-- Import Dialog -->
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
    </div>

    <!-- Channel Management Section -->
    <div
      class="relay-settings relay-settings-desktop"
      v-loading="channelLoading"
      style="margin-top: 16px"
    >
      <el-collapse v-model="desktopSections">
        <el-collapse-item name="channels">
          <template #title>
            <span class="collapse-title">{{ i18ns.t('relay.channelManagement') }}</span>
          </template>
          <div class="flex flex-col gap-3 mb-3">
            <div class="flex flex-wrap items-center gap-2">
              <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                <el-button type="primary" size="small" @click="openCreateChannelDialog">
                  {{ i18ns.t('relay.createChannel') }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                <el-button size="small" @click="openChannelImportDialog">
                  {{ i18ns.t('relay.importChannels') }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.RELAY_CHANNEL_READ]">
                <el-button size="small" @click="exportChannelsAsJson">
                  {{ i18ns.t('relay.exportChannels') }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.RELAY_CHANNEL_READ]">
                <el-button size="small" @click="copyChannelsAsJson">
                  {{ i18ns.t('relay.copyChannels') }}
                </el-button>
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
                  >
                    {{ i18ns.t('relay.batchDuplicateChannels') }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_CHANNEL_READ]">
                  <el-button
                    size="small"
                    :disabled="!hasChannelSelection"
                    @click="exportChannelsAsJson"
                  >
                    {{ i18ns.t('relay.batchExportChannels') }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_CHANNEL_UPDATE]">
                  <el-button
                    size="small"
                    type="success"
                    :disabled="!hasChannelSelection"
                    @click="handleBatchSetChannelStatus(true)"
                  >
                    {{ i18ns.t('relay.batchEnableChannels') }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_CHANNEL_UPDATE]">
                  <el-button
                    size="small"
                    type="warning"
                    :disabled="!hasChannelSelection"
                    @click="handleBatchSetChannelStatus(false)"
                  >
                    {{ i18ns.t('relay.batchDisableChannels') }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_CHANNEL_DELETE]">
                  <el-button
                    size="small"
                    type="danger"
                    :disabled="!hasChannelSelection"
                    @click="handleBatchDeleteChannels"
                  >
                    {{ i18ns.t('relay.batchDeleteChannels') }}
                  </el-button>
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
                    <el-tag
                      v-if="row.allowedFormats.includes('openai')"
                      type="success"
                      size="small"
                    >
                      OpenAI
                    </el-tag>
                    <el-tag
                      v-if="row.allowedFormats.includes('anthropic')"
                      type="warning"
                      size="small"
                    >
                      Anthropic
                    </el-tag>
                    <el-tag
                      v-if="row.allowedFormats.includes('gemini')"
                      type="primary"
                      size="small"
                    >
                      Gemini
                    </el-tag>
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
                >
                  {{ i18ns.t('relay.noModels') }}
                </el-tag>
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
                <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                  {{ row.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled') }}
                </el-tag>
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
              <template #default="{ row }">
                {{ new Date(row.createTime).toLocaleString() }}
              </template>
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
                  <el-button size="small" @click="openEditChannelDialog(row)">
                    {{ i18ns.t('edit') }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                  <el-button size="small" @click="handleDuplicateChannel(row)">
                    {{ i18ns.t('relay.duplicateChannel') }}
                  </el-button>
                </PermissionWrapper>
                <PermissionWrapper :require="[Permission.RELAY_CHANNEL_DELETE]">
                  <el-button size="small" type="danger" @click="handleDeleteChannel(row)">
                    {{ i18ns.t('delete') }}
                  </el-button>
                </PermissionWrapper>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </div>

    <!-- Channel Create / Edit Dialog -->
    <el-dialog
      v-model="showChannelDialog"
      :title="isEditingChannel ? i18ns.t('relay.editChannel') : i18ns.t('relay.createChannel')"
      width="60vw"
      destroy-on-close
    >
      <el-form :model="channelForm" label-width="180px" label-position="right">
        <el-form-item :label="i18ns.t('relay.channelName')" required>
          <el-input
            v-model="channelForm.name"
            :placeholder="i18ns.t('relay.channelNamePlaceholder')"
          />
        </el-form-item>

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
          <span class="ml-3 text-[#909399] text-xs">{{
            i18ns.t('relay.channelMultiplierHelp')
          }}</span>
        </el-form-item>
        <el-form-item :label="i18ns.t('relay.inputTokensIncludeCacheRead')">
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
  </div>
  <div v-else class="mobile-page relay-settings-mobile-adapter">
    <div>
      <el-card v-loading="loading" class="mobile-card relay-settings-mobile-card">
        <template #header>
          <span>{{ i18ns.t('nav.relaySettings') }}</span>
        </template>

        <div class="flex flex-col gap-3">
          <section
            class="border border-[var(--el-border-color-lighter)] rounded-xl bg-[var(--el-fill-color-blank)] overflow-hidden"
          >
            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 px-4 py-3 border-none bg-transparent text-[var(--el-text-color-primary)] text-[15px] font-semibold cursor-pointer"
              @click="toggleMobileSection('basic')"
            >
              <span>{{ i18ns.t('nav.relaySettings') }}</span>
              <span
                :class="[
                  'section-toggle-icon',
                  { 'is-expanded': isMobileSectionExpanded('basic') },
                ]"
                >▾</span
              >
            </button>
            <transition
              name="section-collapse"
              @enter="onCollapseEnter"
              @after-enter="onCollapseAfterEnter"
              @leave="onCollapseLeave"
              @after-leave="onCollapseAfterLeave"
            >
              <div
                v-if="isMobileSectionLoaded('basic')"
                v-show="isMobileSectionExpanded('basic')"
                class="section-body px-4 pb-4"
              >
                <el-form label-position="top" class="relay-settings-form">
                  <el-form-item
                    :label="i18ns.t('ServerConfigView.globalMultiplier')"
                    class="setting-block"
                  >
                    <el-input-number v-model="globalMultiplier" :step="0.000001" :precision="6" />
                    <span class="ml-3 text-[#909399] text-xs">{{
                      i18ns.t('ServerConfigView.globalMultiplierHelp')
                    }}</span>
                  </el-form-item>
                  <el-form-item :label="i18ns.t('relay.uptimeStatusUrl')" class="setting-block">
                    <el-input
                      v-model="uptimeStatusUrl"
                      placeholder="https://example.com/api/uptime/status"
                      clearable
                    />
                    <span class="ml-3 text-[#909399] text-xs">{{
                      i18ns.t('relay.uptimeStatusUrlHelp')
                    }}</span>
                  </el-form-item>
                </el-form>
              </div>
            </transition>
          </section>

          <section
            class="border border-[var(--el-border-color-lighter)] rounded-xl bg-[var(--el-fill-color-blank)] overflow-hidden"
          >
            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 px-4 py-3 border-none bg-transparent text-[var(--el-text-color-primary)] text-[15px] font-semibold cursor-pointer"
              @click="toggleMobileSection('monitor')"
            >
              <span>{{ i18ns.t('relay.monitorConfig') }}</span>
              <span
                :class="[
                  'section-toggle-icon',
                  { 'is-expanded': isMobileSectionExpanded('monitor') },
                ]"
                >▾</span
              >
            </button>
            <transition
              name="section-collapse"
              @enter="onCollapseEnter"
              @after-enter="onCollapseAfterEnter"
              @leave="onCollapseLeave"
              @after-leave="onCollapseAfterLeave"
            >
              <div
                v-if="isMobileSectionLoaded('monitor')"
                v-show="isMobileSectionExpanded('monitor')"
                class="section-body px-4 pb-4"
              >
                <el-form label-position="top" class="relay-settings-form">
                  <el-form-item :label="i18ns.t('relay.monitorConfig')" class="setting-block">
                    <div
                      class="w-full border border-[var(--el-border-color-lighter)] rounded-xl p-3 bg-[var(--el-fill-color-blank)]"
                    >
                      <div class="flex items-center justify-between gap-2.5">
                        <span class="font-semibold text-[var(--el-text-color-primary)]">{{
                          i18ns.t('relay.monitorConfig')
                        }}</span>
                        <el-switch v-model="monitorConfigEnabled" />
                      </div>
                      <span class="ml-3 text-[#909399] text-xs">{{
                        i18ns.t('relay.monitorConfigHelp')
                      }}</span>
                      <div v-if="monitorConfigEnabled" class="mt-3">
                        <el-alert type="info" :closable="false" class="mb-3">
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
                        <el-checkbox v-model="showOnlyConfigured" class="mb-3">
                          {{ i18ns.t('ServerConfigView.showOnlyConfigured') }}
                        </el-checkbox>
                        <div v-if="monitorConfigs.length" class="flex flex-col gap-3">
                          <el-card
                            v-for="(row, index) in monitorConfigs"
                            :key="`monitor-${index}`"
                            shadow="never"
                            class="config-item-card"
                          >
                            <div class="grid grid-cols-2 gap-2.5 mt-2.5">
                              <div class="flex flex-col gap-1.5">
                                <span
                                  class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                                  >{{ i18ns.t('ServerConfigView.monitorId') }}</span
                                >
                                <el-input
                                  v-model="row.monitorId"
                                  size="small"
                                  placeholder="2"
                                  @input="row.monitorId = row.monitorId.replace(/[^0-9]/g, '')"
                                />
                              </div>
                              <div class="flex flex-col gap-1.5">
                                <span
                                  class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                                  >{{ i18ns.t('ServerConfigView.monitorDisplayName') }}</span
                                >
                                <el-input
                                  v-model="row.displayName"
                                  size="small"
                                  :placeholder="
                                    i18ns.t('ServerConfigView.monitorDisplayNamePlaceholder')
                                  "
                                />
                              </div>
                            </div>
                            <div class="flex flex-wrap gap-2">
                              <el-button
                                size="small"
                                type="danger"
                                @click="monitorConfigs.splice(index, 1)"
                              >
                                {{ i18ns.t('delete') }}
                              </el-button>
                            </div>
                          </el-card>
                        </div>
                        <el-button size="small" class="mt-2 w-full" @click="addMonitorConfig">
                          {{ i18ns.t('relay.addMonitorConfig') }}
                        </el-button>
                      </div>
                    </div>
                  </el-form-item>
                </el-form>
              </div>
            </transition>
          </section>

          <section
            class="border border-[var(--el-border-color-lighter)] rounded-xl bg-[var(--el-fill-color-blank)] overflow-hidden"
          >
            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 px-4 py-3 border-none bg-transparent text-[var(--el-text-color-primary)] text-[15px] font-semibold cursor-pointer"
              @click="toggleMobileSection('queue')"
            >
              <span>{{ i18ns.t('ServerConfigView.enableQueue') }}</span>
              <span
                :class="[
                  'section-toggle-icon',
                  { 'is-expanded': isMobileSectionExpanded('queue') },
                ]"
                >▾</span
              >
            </button>
            <transition
              name="section-collapse"
              @enter="onCollapseEnter"
              @after-enter="onCollapseAfterEnter"
              @leave="onCollapseLeave"
              @after-leave="onCollapseAfterLeave"
            >
              <div
                v-if="isMobileSectionLoaded('queue')"
                v-show="isMobileSectionExpanded('queue')"
                class="section-body px-4 pb-4"
              >
                <el-form label-position="top" class="relay-settings-form">
                  <el-form-item
                    :label="i18ns.t('ServerConfigView.enableQueue')"
                    class="setting-block"
                  >
                    <div
                      class="w-full border border-[var(--el-border-color-lighter)] rounded-xl p-3 bg-[var(--el-fill-color-blank)]"
                    >
                      <div class="flex items-center justify-between gap-2.5">
                        <span class="font-semibold text-[var(--el-text-color-primary)]">{{
                          i18ns.t('ServerConfigView.enableQueue')
                        }}</span>
                        <el-switch v-model="enableQueue" />
                      </div>
                    </div>
                    <span class="ml-3 text-[#909399] text-xs">{{
                      i18ns.t('ServerConfigView.enableQueueHelp')
                    }}</span>
                  </el-form-item>
                  <el-form-item
                    :label="i18ns.t('ServerConfigView.maxConcurrency')"
                    class="setting-block"
                  >
                    <el-input-number
                      v-model="maxConcurrency"
                      :min="1"
                      :max="100"
                      :step="1"
                      :precision="0"
                    />
                    <span class="ml-3 text-[#909399] text-xs">{{
                      i18ns.t('ServerConfigView.maxConcurrencyHelp')
                    }}</span>
                  </el-form-item>
                  <el-form-item
                    :label="i18ns.t('ServerConfigView.queueTimeout')"
                    class="setting-block"
                  >
                    <el-input-number v-model="queueTimeoutSec" :min="0" :step="1" :precision="0" />
                    <span class="ml-3 text-[#909399] text-xs">{{
                      i18ns.t('ServerConfigView.queueTimeoutHelp')
                    }}</span>
                  </el-form-item>
                  <el-form-item
                    :label="i18ns.t('ServerConfigView.upstreamStreamTimeout')"
                    class="setting-block"
                  >
                    <el-input-number
                      v-model="upstreamStreamTimeoutSec"
                      :min="0"
                      :step="1"
                      :precision="0"
                    />
                    <span class="ml-3 text-[#909399] text-xs">{{
                      i18ns.t('ServerConfigView.upstreamStreamTimeoutHelp')
                    }}</span>
                  </el-form-item>
                </el-form>
              </div>
            </transition>
          </section>

          <section
            class="border border-[var(--el-border-color-lighter)] rounded-xl bg-[var(--el-fill-color-blank)] overflow-hidden"
          >
            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 px-4 py-3 border-none bg-transparent text-[var(--el-text-color-primary)] text-[15px] font-semibold cursor-pointer"
              @click="toggleMobileSection('pricing')"
            >
              <span>{{ i18ns.t('ServerConfigView.allowedModelsAndPricing') }}</span>
              <span
                :class="[
                  'section-toggle-icon',
                  { 'is-expanded': isMobileSectionExpanded('pricing') },
                ]"
                >▾</span
              >
            </button>
            <transition
              name="section-collapse"
              @enter="onCollapseEnter"
              @after-enter="onCollapseAfterEnter"
              @leave="onCollapseLeave"
              @after-leave="onCollapseAfterLeave"
            >
              <div
                v-if="isMobileSectionLoaded('pricing')"
                v-show="isMobileSectionExpanded('pricing')"
                class="section-body px-4 pb-4"
              >
                <el-form label-position="top" class="relay-settings-form">
                  <el-form-item
                    :label="i18ns.t('ServerConfigView.allowedModelsAndPricing')"
                    class="setting-block"
                  >
                    <div
                      class="w-full border border-[var(--el-border-color-lighter)] rounded-xl p-3 bg-[var(--el-fill-color-blank)]"
                    >
                      <div class="flex flex-wrap gap-2">
                        <el-button size="small" @click="exportModelPricing">
                          {{ i18ns.t('ServerConfigView.exportPricing') }}
                        </el-button>
                        <el-button size="small" @click="copyModelPricing">
                          {{ i18ns.t('ServerConfigView.copyPricing') }}
                        </el-button>
                        <el-button size="small" @click="showImportDialog = true">
                          {{ i18ns.t('ServerConfigView.importPricing') }}
                        </el-button>
                      </div>
                      <div v-if="modelRates.length" class="flex flex-col gap-3">
                        <el-card
                          v-for="(row, index) in modelRates"
                          :key="getModelRateRowKey(row)"
                          shadow="never"
                          :class="['config-item-card', { 'is-editing': editingRowIndex === index }]"
                          @click="editingRowIndex = editingRowIndex === index ? null : index"
                        >
                          <div class="config-item-header">
                            <div class="config-item-title">
                              {{ row.model || i18ns.t('ServerConfigView.modelNamePlaceholder') }}
                            </div>
                            <div class="flex items-center gap-1.5 shrink-0">
                              <el-tag
                                size="small"
                                :type="row.pricingType === 'per-request' ? 'warning' : 'success'"
                              >
                                {{
                                  row.pricingType === 'per-request'
                                    ? i18ns.t('ServerConfigView.pricingTypePerRequest')
                                    : i18ns.t('ServerConfigView.pricingTypeTokenBased')
                                }}
                              </el-tag>
                              <span
                                :class="[
                                  'section-toggle-icon',
                                  { 'is-expanded': editingRowIndex === index },
                                ]"
                                style="font-size: 14px; margin-left: 2px"
                                >▾</span
                              >
                            </div>
                          </div>
                          <div v-if="editingRowIndex !== index" class="mt-2 flex flex-col gap-1">
                            <div class="flex justify-between items-center gap-2">
                              <span
                                class="text-xs text-[var(--el-text-color-secondary)] shrink-0"
                                >{{ i18ns.t('ServerConfigView.modelId') }}</span
                              >
                              <span
                                class="text-xs text-[var(--el-text-color-primary)] font-medium text-right"
                                >{{ row.modelId || row.model || '-' }}</span
                              >
                            </div>
                            <template v-if="row.pricingType === 'per-request'">
                              <div class="flex justify-between items-center gap-2">
                                <span
                                  class="text-xs text-[var(--el-text-color-secondary)] shrink-0"
                                  >{{ i18ns.t('ServerConfigView.fixedPrice') }}</span
                                >
                                <span
                                  class="text-xs text-[var(--el-text-color-primary)] font-medium text-right"
                                  >{{ row.fixedPrice ?? '-' }}</span
                                >
                              </div>
                            </template>
                            <template v-else>
                              <div class="flex justify-between items-center gap-2">
                                <span
                                  class="text-xs text-[var(--el-text-color-secondary)] shrink-0"
                                  >{{ i18ns.t('ServerConfigView.inputPricePerMillion') }}</span
                                >
                                <span
                                  class="text-xs text-[var(--el-text-color-primary)] font-medium text-right"
                                  >{{ row.inputPrice }}</span
                                >
                              </div>
                              <div class="flex justify-between items-center gap-2">
                                <span
                                  class="text-xs text-[var(--el-text-color-secondary)] shrink-0"
                                  >{{ i18ns.t('ServerConfigView.outputPricePerMillion') }}</span
                                >
                                <span
                                  class="text-xs text-[var(--el-text-color-primary)] font-medium text-right"
                                  >{{ row.outputPrice }}</span
                                >
                              </div>
                            </template>
                            <div
                              v-if="
                                Array.isArray(row.supportedFormats) && row.supportedFormats.length
                              "
                              class="flex justify-between items-center gap-2"
                            >
                              <span
                                class="text-xs text-[var(--el-text-color-secondary)] shrink-0"
                                >{{ i18ns.t('ServerConfigView.supportedFormats') }}</span
                              >
                              <span
                                class="text-xs text-[var(--el-text-color-primary)] font-medium text-right"
                                >{{ row.supportedFormats.join(', ') }}</span
                              >
                            </div>
                          </div>
                          <div
                            v-if="editingRowIndex === index"
                            class="mt-3 flex flex-col gap-2.5"
                            @click.stop
                          >
                            <div class="grid grid-cols-1 gap-2.5">
                              <div class="flex flex-col gap-1.5">
                                <span
                                  class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                                  >{{ i18ns.t('ServerConfigView.modelName') }}</span
                                >
                                <el-input
                                  v-model="row.model"
                                  size="small"
                                  :placeholder="i18ns.t('ServerConfigView.modelNamePlaceholder')"
                                />
                              </div>
                              <div class="flex flex-col gap-1.5">
                                <span
                                  class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                                  >{{ i18ns.t('ServerConfigView.modelId') }}</span
                                >
                                <el-input
                                  v-model="row.modelId"
                                  size="small"
                                  :placeholder="i18ns.t('ServerConfigView.modelIdPlaceholder')"
                                />
                              </div>
                            </div>
                            <div class="grid grid-cols-2 gap-2.5">
                              <div class="flex flex-col gap-1.5">
                                <span
                                  class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                                  >{{ i18ns.t('ServerConfigView.pricingType') }}</span
                                >
                                <el-select v-model="row.pricingType" size="small">
                                  <el-option
                                    :label="i18ns.t('ServerConfigView.pricingTypeTokenBased')"
                                    value="token-based"
                                  />
                                  <el-option
                                    :label="i18ns.t('ServerConfigView.pricingTypePerRequest')"
                                    value="per-request"
                                  />
                                </el-select>
                              </div>
                              <div class="flex flex-col gap-1.5">
                                <span
                                  class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                                  >{{ i18ns.t('ServerConfigView.supportedFormats') }}</span
                                >
                                <el-select
                                  v-model="row.supportedFormats"
                                  size="small"
                                  :placeholder="i18ns.t('ServerConfigView.selectFormat')"
                                  multiple
                                >
                                  <el-option label="OpenAI" value="openai" />
                                  <el-option label="Anthropic" value="anthropic" />
                                  <el-option label="Gemini" value="gemini" />
                                </el-select>
                              </div>
                            </div>
                            <div
                              v-if="row.pricingType === 'per-request'"
                              class="grid grid-cols-1 gap-2.5"
                            >
                              <div class="flex flex-col gap-1.5">
                                <span
                                  class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                                  >{{ i18ns.t('ServerConfigView.fixedPrice') }}</span
                                >
                                <el-input-number
                                  v-model="row.fixedPrice"
                                  :step="0.01"
                                  :precision="4"
                                  size="small"
                                  style="width: 100%"
                                />
                              </div>
                            </div>
                            <div v-else class="grid grid-cols-2 gap-2.5">
                              <div class="flex flex-col gap-1.5">
                                <span
                                  class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                                  >{{ i18ns.t('ServerConfigView.inputPricePerMillion') }}</span
                                >
                                <el-input-number
                                  v-model="row.inputPrice"
                                  :step="0.01"
                                  :precision="6"
                                  size="small"
                                  style="width: 100%"
                                />
                              </div>
                              <div class="flex flex-col gap-1.5">
                                <span
                                  class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                                  >{{ i18ns.t('ServerConfigView.outputPricePerMillion') }}</span
                                >
                                <el-input-number
                                  v-model="row.outputPrice"
                                  :step="0.01"
                                  :precision="6"
                                  size="small"
                                  style="width: 100%"
                                />
                              </div>
                              <div class="flex flex-col gap-1.5">
                                <span
                                  class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                                  >{{ i18ns.t('ServerConfigView.cacheCreationMultiplier') }}</span
                                >
                                <el-input-number
                                  v-model="row.cacheCreationMultiplier"
                                  :step="0.01"
                                  :precision="2"
                                  size="small"
                                  style="width: 100%"
                                />
                              </div>
                              <div class="flex flex-col gap-1.5">
                                <span
                                  class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                                  >{{ i18ns.t('ServerConfigView.cacheReadMultiplier') }}</span
                                >
                                <el-input-number
                                  v-model="row.cacheReadMultiplier"
                                  :step="0.01"
                                  :precision="2"
                                  size="small"
                                  style="width: 100%"
                                />
                              </div>
                            </div>
                            <div class="flex flex-wrap gap-2 mt-3">
                              <el-button
                                size="small"
                                type="danger"
                                @click.stop="
                                  () => {
                                    modelRates.splice(index, 1)
                                    editingRowIndex = null
                                  }
                                "
                              >
                                {{ i18ns.t('delete') }}
                              </el-button>
                            </div>
                          </div>
                        </el-card>
                      </div>
                      <el-button size="small" class="mt-2 w-full" @click="addModelRate">
                        {{ i18ns.t('ServerConfigView.addModel') }}
                      </el-button>
                      <span class="ml-3 text-[#909399] text-xs">{{
                        i18ns.t('ServerConfigView.modelPricingHelp')
                      }}</span>
                    </div>
                  </el-form-item>
                </el-form>
              </div>
            </transition>
          </section>
        </div>

        <div class="mt-4 flex justify-end">
          <el-button type="primary" :loading="saving" @click="save">
            {{ i18ns.t('save') }}
          </el-button>
        </div>

        <!-- Import Dialog -->
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
      </el-card>

      <!-- Channel Management Section -->
      <el-card
        style="margin-top: 16px"
        v-loading="channelLoading"
        class="mobile-card relay-settings-mobile-card"
      >
        <template #header>
          <div class="flex flex-col gap-2">
            <div class="flex justify-between items-center gap-3">
              <span>{{ i18ns.t('relay.channelManagement') }}</span>
              <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                <el-button type="primary" size="small" @click="openCreateChannelDialog">
                  {{ i18ns.t('relay.createChannel') }}
                </el-button>
              </PermissionWrapper>
            </div>
            <div class="flex flex-wrap gap-2">
              <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                <el-button size="small" @click="openChannelImportDialog">
                  {{ i18ns.t('relay.importChannels') }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.RELAY_CHANNEL_READ]">
                <el-button size="small" @click="exportChannelsAsJson">
                  {{ i18ns.t('relay.exportChannels') }}
                </el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.RELAY_CHANNEL_READ]">
                <el-button size="small" @click="copyChannelsAsJson">
                  {{ i18ns.t('relay.copyChannels') }}
                </el-button>
              </PermissionWrapper>
            </div>
          </div>
        </template>

        <section class="border-none bg-transparent">
          <button
            type="button"
            class="w-full flex items-center justify-between gap-3 px-4 py-3 border-none bg-transparent text-[var(--el-text-color-primary)] text-[15px] font-semibold cursor-pointer"
            @click="toggleMobileSection('channels')"
          >
            <span>{{ i18ns.t('relay.channelManagement') }}</span>
            <span
              :class="[
                'section-toggle-icon',
                { 'is-expanded': isMobileSectionExpanded('channels') },
              ]"
              >▾</span
            >
          </button>
          <transition
            name="section-collapse"
            @enter="onCollapseEnter"
            @after-enter="onCollapseAfterEnter"
            @leave="onCollapseLeave"
            @after-leave="onCollapseAfterLeave"
          >
            <div
              v-if="isMobileSectionLoaded('channels')"
              v-show="isMobileSectionExpanded('channels')"
              class="section-body"
            >
              <div class="flex flex-col gap-2 px-4 pb-3">
                <div class="flex flex-wrap items-center gap-2 justify-between">
                  <el-tag v-if="selectedChannels.length" type="info" size="small">
                    {{ i18ns.t('relay.selectedChannels', { count: selectedChannels.length }) }}
                  </el-tag>
                  <div class="flex flex-wrap items-center gap-2">
                    <el-button text size="small" @click="toggleAllChannels(!isAllChannelsSelected)">
                      {{
                        isAllChannelsSelected
                          ? i18ns.t('relay.clearChannelSelection')
                          : i18ns.t('relay.selectAllChannels')
                      }}
                    </el-button>
                    <el-button
                      text
                      size="small"
                      :disabled="!hasChannelSelection"
                      @click="clearChannelSelection"
                    >
                      {{ i18ns.t('relay.clearChannelSelection') }}
                    </el-button>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                    <el-button
                      size="small"
                      :disabled="!hasChannelSelection"
                      @click="handleBatchDuplicateChannels"
                    >
                      {{ i18ns.t('relay.batchDuplicateChannels') }}
                    </el-button>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_READ]">
                    <el-button
                      size="small"
                      :disabled="!hasChannelSelection"
                      @click="exportChannelsAsJson"
                    >
                      {{ i18ns.t('relay.batchExportChannels') }}
                    </el-button>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_UPDATE]">
                    <el-button
                      size="small"
                      type="success"
                      :disabled="!hasChannelSelection"
                      @click="handleBatchSetChannelStatus(true)"
                    >
                      {{ i18ns.t('relay.batchEnableChannels') }}
                    </el-button>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_UPDATE]">
                    <el-button
                      size="small"
                      type="warning"
                      :disabled="!hasChannelSelection"
                      @click="handleBatchSetChannelStatus(false)"
                    >
                      {{ i18ns.t('relay.batchDisableChannels') }}
                    </el-button>
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_DELETE]">
                    <el-button
                      size="small"
                      type="danger"
                      :disabled="!hasChannelSelection"
                      @click="handleBatchDeleteChannels"
                    >
                      {{ i18ns.t('relay.batchDeleteChannels') }}
                    </el-button>
                  </PermissionWrapper>
                </div>
              </div>
              <div v-if="channels.length" class="flex flex-col gap-3">
                <el-card
                  v-for="row in channels"
                  :key="row.id"
                  shadow="never"
                  class="config-item-card"
                >
                  <div class="config-item-header">
                    <div class="flex items-center gap-2">
                      <el-checkbox
                        :model-value="isChannelSelected(row.id)"
                        @change="toggleChannelSelection(row.id, $event)"
                      />
                      <div class="config-item-title">{{ row.name }}</div>
                    </div>
                    <div class="flex items-center gap-2">
                      <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
                        {{ row.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled') }}
                      </el-tag>
                      <el-tag size="small" type="primary">{{ row.multiplier }}x</el-tag>
                    </div>
                  </div>
                  <div class="mt-3 flex flex-col gap-1.5">
                    <span
                      class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                      >{{ i18ns.t('relay.supportedFormats') }}</span
                    >
                    <div class="flex flex-wrap gap-2">
                      <template v-if="row.allowedFormats === 'all'">
                        <el-tag type="success" size="small">OpenAI</el-tag>
                        <el-tag type="warning" size="small">Anthropic</el-tag>
                        <el-tag type="primary" size="small">Gemini</el-tag>
                      </template>
                      <template v-else>
                        <el-tag
                          v-if="row.allowedFormats.includes('openai')"
                          type="success"
                          size="small"
                        >
                          OpenAI
                        </el-tag>
                        <el-tag
                          v-if="row.allowedFormats.includes('anthropic')"
                          type="warning"
                          size="small"
                        >
                          Anthropic
                        </el-tag>
                        <el-tag
                          v-if="row.allowedFormats.includes('gemini')"
                          type="primary"
                          size="small"
                        >
                          Gemini
                        </el-tag>
                      </template>
                    </div>
                  </div>
                  <div class="mt-3 flex flex-col gap-1.5">
                    <span
                      class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                      >{{ i18ns.t('relay.allowedModelsChannel') }}</span
                    >
                    <div class="flex flex-wrap gap-2">
                      <el-tag v-if="!row.allowedModels" type="info" size="small">{{
                        i18ns.t('relay.allModels')
                      }}</el-tag>
                      <el-tag
                        v-else-if="parseAllowedModels(row.allowedModels).length === 0"
                        type="danger"
                        size="small"
                      >
                        {{ i18ns.t('relay.noModels') }}
                      </el-tag>
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
                    </div>
                  </div>
                  <div class="mt-3 flex flex-col gap-1.5">
                    <span
                      class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                      >{{ i18ns.t('relay.upstreamConfig') }}</span
                    >
                    <div class="flex flex-col gap-2">
                      <div
                        v-if="computeShowUpstream(row.allowedFormats.split(','), 'openai')"
                        class="flex items-start gap-2 text-xs text-[var(--el-text-color-regular)]"
                      >
                        <el-tag size="small" type="success">OpenAI</el-tag>
                        <span class="break-all">{{ row.openaiUpstreamUrl || '-' }}</span>
                      </div>
                      <div
                        v-if="computeShowUpstream(row.allowedFormats.split(','), 'anthropic')"
                        class="flex items-start gap-2 text-xs text-[var(--el-text-color-regular)]"
                      >
                        <el-tag size="small" type="warning">Anthropic</el-tag>
                        <span class="break-all">{{ row.anthropicUpstreamUrl || '-' }}</span>
                      </div>
                      <div
                        v-if="computeShowUpstream(row.allowedFormats.split(','), 'gemini')"
                        class="flex items-start gap-2 text-xs text-[var(--el-text-color-regular)]"
                      >
                        <el-tag size="small" type="primary">Gemini</el-tag>
                        <span class="break-all">{{ row.geminiUpstreamUrl || '-' }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center justify-between gap-2.5 mt-3">
                    <span
                      class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                      >{{ i18ns.t('relay.createTime') }}</span
                    >
                    <span>{{ new Date(row.createTime).toLocaleString() }}</span>
                  </div>
                  <div class="flex flex-wrap gap-2">
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
                      <el-button size="small" @click="openEditChannelDialog(row)">
                        {{ i18ns.t('edit') }}
                      </el-button>
                    </PermissionWrapper>
                    <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                      <el-button size="small" @click="handleDuplicateChannel(row)">
                        {{ i18ns.t('relay.duplicateChannel') }}
                      </el-button>
                    </PermissionWrapper>
                    <PermissionWrapper :require="[Permission.RELAY_CHANNEL_DELETE]">
                      <el-button size="small" type="danger" @click="handleDeleteChannel(row)">
                        {{ i18ns.t('delete') }}
                      </el-button>
                    </PermissionWrapper>
                  </div>
                </el-card>
              </div>
              <el-empty v-else />
            </div>
          </transition>
        </section>

        <!-- Channel Create / Edit Dialog -->
        <el-dialog
          v-model="showChannelDialog"
          :title="isEditingChannel ? i18ns.t('relay.editChannel') : i18ns.t('relay.createChannel')"
          width="650px"
          destroy-on-close
        >
          <el-form :model="channelForm" label-width="180px" label-position="right">
            <el-form-item :label="i18ns.t('relay.channelName')" required>
              <el-input
                v-model="channelForm.name"
                :placeholder="i18ns.t('relay.channelNamePlaceholder')"
              />
            </el-form-item>

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
                />
              </el-form-item>
            </template>

            <el-divider content-position="left">{{ i18ns.t('relay.channelSettings') }}</el-divider>
            <el-form-item :label="i18ns.t('relay.channelMultiplier')">
              <el-input-number v-model="channelForm.multiplier" :step="0.000001" :precision="6" />
              <span class="ml-3 text-[#909399] text-xs">{{
                i18ns.t('relay.channelMultiplierHelp')
              }}</span>
            </el-form-item>

            <el-divider content-position="left">{{
              i18ns.t('relay.modelMappingSection')
            }}</el-divider>
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
            <el-button type="primary" @click="handleImportChannels">{{
              i18ns.t('confirm')
            }}</el-button>
          </template>
        </el-dialog>
      </el-card>
    </div>
  </div>

  <el-dialog
    v-model="timeRuleDialogVisible"
    :title="
      editingTimeRuleIndex >= 0 ? i18ns.t('relay.timeRuleEdit') : i18ns.t('relay.timeRuleAdd')
    "
    width="450px"
    append-to-body
    :close-on-click-modal="false"
  >
    <el-form
      ref="timeRuleFormRef"
      :model="timeRuleForm"
      :rules="timeRuleFormRules"
      label-width="100px"
      label-position="top"
    >
      <el-form-item :label="i18ns.t('relay.timeRuleName')" prop="name">
        <el-input v-model="timeRuleForm.name" />
      </el-form-item>
      <el-form-item :label="i18ns.t('relay.timeRuleDays')" prop="dayOfWeek">
        <el-checkbox-group v-model="timeRuleDays">
          <el-checkbox v-for="d in timeRuleDayOptions" :key="d.value" :label="d.value" border>
            {{ d.label }}
          </el-checkbox>
        </el-checkbox-group>
        <div class="form-help">
          <el-button size="small" @click="timeRuleDays = [1, 2, 3, 4, 5, 6, 7]">{{
            i18ns.t('relay.timeRuleSelectAll')
          }}</el-button>
          <el-button size="small" @click="timeRuleDays = []">{{
            i18ns.t('relay.timeRuleClear')
          }}</el-button>
        </div>
      </el-form-item>
      <el-form-item :label="i18ns.t('relay.timeRuleTimeRange')" prop="timeRange">
        <el-time-picker
          v-model="timeRuleRange"
          is-range
          range-separator="-"
          format="HH:mm"
          value-format="HH:mm"
          start-placeholder="Start"
          end-placeholder="End"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('relay.timeRuleMultiplier')" prop="multiplier">
        <el-input-number
          v-model="timeRuleForm.multiplier"
          :min="0.01"
          :max="100"
          :step="0.1"
          :precision="2"
        />
      </el-form-item>
      <el-form-item :label="i18ns.t('relay.timeRuleEnabled')">
        <el-switch v-model="timeRuleForm.enabled" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="timeRuleDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button type="primary" @click="saveTimeRule">{{ i18ns.t('confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import ModelMappingEditor from '@/components/relay/ModelMappingEditor.vue'
import { usePageDevice } from '@/composables/usePageDevice'
import { Permission } from '@/constant/permission'
import { ref, onMounted, computed, watch } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { relayConfigService } from '@/service/relayConfigService'
import { relayChannelService } from '@/service/relayChannelService'
import { copyTextWithFallback } from '@/utils/clipboard'
import {
  normalizeRelayFormats,
  serializeRelayFormats,
  toConfiguredRelayFormats,
} from '../../utils/relay-formats'
import type {
  ModelPricingItemDto,
  RelayChannelDto,
  RelayChannelImportItemDto,
  TimePeriodMultiplierRule,
  UpdateRelayConfigRequest,
} from '@/client/types.gen'

const loading = ref(false)
const saving = ref(false)
const showImportDialog = ref(false)
const importText = ref('')
const editingRowIndex = ref<number | null>(null)
const desktopSections = ref<string[]>([])
const mobileSections = ref<string[]>([])
const desktopSectionLoaded = ref<Record<string, boolean>>({})
const mobileSectionLoaded = ref<Record<string, boolean>>({})
const heavySections = new Set(['monitor', 'pricing', 'channels'])

const importPricingPlaceholder = computed(() =>
  [
    i18ns.t('ServerConfigView.importPricingPlaceholder'),
    '{',
    '  "models": [',
    '    { "model": "gpt-4", "inputPrice": 30, "outputPrice": 60 }',
    '  ]',
    '}',
  ].join('\n'),
)

const channelImportPlaceholder = computed(() =>
  [
    i18ns.t('relay.channelImportPlaceholder'),
    '{',
    '  "channels": [',
    '    { "name": "Primary Channel", "allowedFormats": "openai", "enabled": true }',
    '  ]',
    '}',
  ].join('\n'),
)

type ModelRateRow = {
  model: string
  modelId: string
  pricingType?: 'token-based' | 'per-request'
  inputPrice: number
  outputPrice: number
  fixedPrice?: number
  cacheCreationMultiplier: number
  cacheReadMultiplier: number
  supportedFormats: string[] | string
}

type ModelIdentitySource = {
  model?: string | null
  modelId?: string | null
  provider?: string | null
}

type RelayConfigModelRateItem = ModelPricingItemDto & { provider?: string | null }

type RelayConfigUpdatePayload = Omit<
  UpdateRelayConfigRequest,
  'modelRates' | 'monitorNameMapping'
> & {
  modelRates: ModelPricingItemDto[]
  monitorNameMapping?: Record<string, string> | null
}

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/

const resolveModelId = (source: ModelIdentitySource): string => {
  const explicitModelId = source.modelId?.trim()
  if (explicitModelId) return explicitModelId

  const providerModelId = source.provider?.trim()
  if (providerModelId) return providerModelId

  return source.model?.trim() || ''
}

const normalizeSupportedFormats = (formats?: string): string[] => toConfiguredRelayFormats(formats)

const serializeSupportedFormats = (formats: string[] | string): string =>
  serializeRelayFormats(formats)

const toSupportedFormatsArray = (formats: string[] | string | undefined): string[] => {
  return toConfiguredRelayFormats(formats)
}

let modelRateRowCounter = 0
const modelRateRowKeyMap = new WeakMap<ModelRateRow, string>()

const getModelRateRowKey = (row: ModelRateRow): string => {
  const existing = modelRateRowKeyMap.get(row)
  if (existing) return existing

  const key = `model-rate-${++modelRateRowCounter}`
  modelRateRowKeyMap.set(row, key)
  return key
}

const modelRates = ref<ModelRateRow[]>([])
const globalMultiplier = ref(1)
const uptimeStatusUrl = ref('')
const enableQueue = ref(true)
const maxConcurrency = ref(5)
const queueTimeoutSec = ref(30)
const upstreamStreamTimeoutSec = ref(120)

// Monitor configuration
const monitorConfigEnabled = ref(false)
const showOnlyConfigured = ref(false)
const monitorConfigs = ref<
  {
    monitorId: string
    displayName: string
  }[]
>([])

const loadConfig = async () => {
  loading.value = true
  try {
    const relayConfig = await relayConfigService.getRelayConfig()
    globalMultiplier.value = relayConfig.globalMultiplier
    uptimeStatusUrl.value = relayConfig.uptimeStatusUrl || ''
    enableQueue.value = relayConfig.enableQueue ?? true
    maxConcurrency.value = relayConfig.maxConcurrency ?? 5
    queueTimeoutSec.value = Math.round((relayConfig.queueTimeout ?? 30000) / 1000)
    upstreamStreamTimeoutSec.value = Math.round(
      (relayConfig.upstreamStreamTimeout ?? 120000) / 1000,
    )

    // Parse monitor name mapping
    if (relayConfig.monitorNameMapping) {
      monitorConfigEnabled.value = true
      showOnlyConfigured.value = relayConfig.showOnlyConfigured ?? false
      monitorConfigs.value = Object.entries(relayConfig.monitorNameMapping).map(([id, name]) => ({
        monitorId: id,
        displayName: name as string,
      }))
    } else {
      monitorConfigEnabled.value = false
      showOnlyConfigured.value = false
      monitorConfigs.value = []
    }

    modelRates.value = (relayConfig.modelRates || []).map((m: RelayConfigModelRateItem) => {
      const modelName = (m.model || '').trim()
      const modelId = resolveModelId(m)
      return {
        model: modelName,
        modelId: modelId || modelName,
        pricingType: m.pricingType || 'token-based',
        inputPrice: m.inputPrice,
        outputPrice: m.outputPrice,
        fixedPrice: m.fixedPrice,
        cacheCreationMultiplier: m.cacheCreationMultiplier ?? 1.25,
        cacheReadMultiplier: m.cacheReadMultiplier ?? 0.1,
        supportedFormats: normalizeSupportedFormats(m.supportedFormats),
      }
    })
  } catch (error: any) {
    console.error('loadConfig error:', error)
    ElMessage.error(error.message || i18ns.t('ServerConfigView.loadFailed'))
  } finally {
    loading.value = false
  }
}

const save = async () => {
  saving.value = true
  try {
    const validRates = modelRates.value.filter((r) => {
      const model = r.model.trim()
      const pricingType = r.pricingType || 'token-based'

      if (!model) return false

      // Validate per-request pricing
      if (pricingType === 'per-request') {
        return r.fixedPrice != null && r.fixedPrice > 0
      }

      // Validate token-based pricing
      return r.inputPrice > 0 && r.outputPrice > 0
    })

    const modelNames = validRates.map((r) => r.model.trim())
    const uniqueModels = new Set(modelNames)
    if (uniqueModels.size !== modelNames.length) {
      ElMessage.error(i18ns.t('ServerConfigView.duplicateModelName'))
      return
    }

    const normalizedModelIds = validRates.map((rate) =>
      resolveModelId({ model: rate.model, modelId: rate.modelId }),
    )
    const invalidModelId = normalizedModelIds.find((modelId) => !MODEL_ID_PATTERN.test(modelId))
    if (invalidModelId) {
      ElMessage.error(`Invalid model ID format: ${invalidModelId}`)
      return
    }

    // Build monitor name mapping
    let monitorNameMapping: Record<string, string> | null = null
    if (monitorConfigEnabled.value) {
      const validConfigs = monitorConfigs.value.filter(
        (c) => c.monitorId.trim() && c.displayName.trim(),
      )
      if (validConfigs.length > 0) {
        monitorNameMapping = {}
        validConfigs.forEach((c) => {
          monitorNameMapping![c.monitorId.trim()] = c.displayName.trim()
        })
      }
    }

    const payload: RelayConfigUpdatePayload = {
      globalMultiplier: globalMultiplier.value,
      uptimeStatusUrl: uptimeStatusUrl.value || undefined,
      monitorNameMapping: monitorNameMapping,
      showOnlyConfigured: monitorNameMapping ? showOnlyConfigured.value : false,
      uptimeTransformRules: undefined, // 移除旧的复杂转换规则
      uptimeStaticData: undefined,
      enableQueue: enableQueue.value,
      maxConcurrency: maxConcurrency.value,
      queueTimeout: queueTimeoutSec.value * 1000,
      upstreamStreamTimeout: upstreamStreamTimeoutSec.value * 1000,
      modelRates: validRates.map((r) => ({
        model: r.model.trim(),
        modelId: resolveModelId({ model: r.model, modelId: r.modelId }),
        pricingType: r.pricingType || 'token-based',
        inputPrice: r.inputPrice,
        outputPrice: r.outputPrice,
        fixedPrice: r.fixedPrice,
        cacheCreationMultiplier: r.cacheCreationMultiplier,
        cacheReadMultiplier: r.cacheReadMultiplier,
        supportedFormats: serializeSupportedFormats(r.supportedFormats),
      })),
    }

    await relayConfigService.updateRelayConfig(payload)

    ElMessage.success(i18ns.t('ServerConfigView.saveSuccess'))
    // 重新加载可用模型列表以更新下拉选项
    await loadAvailableModels()
  } catch (error: any) {
    console.error('save error:', error)
    ElMessage.error(error.message || i18ns.t('ServerConfigView.saveFailed'))
  } finally {
    saving.value = false
  }
}

const exportModelPricing = () => {
  const data = {
    models: modelRates.value
      .filter((r) => r.model.trim())
      .map((r) => ({
        model: r.model.trim(),
        modelId: resolveModelId({ model: r.model, modelId: r.modelId }),
        pricingType: r.pricingType || 'token-based',
        inputPrice: r.inputPrice,
        outputPrice: r.outputPrice,
        fixedPrice: r.fixedPrice,
        cacheCreationMultiplier: r.cacheCreationMultiplier,
        cacheReadMultiplier: r.cacheReadMultiplier,
        supportedFormats: serializeSupportedFormats(r.supportedFormats),
      })),
  }
  const jsonStr = JSON.stringify(data, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `model-pricing-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(i18ns.t('ServerConfigView.exportSuccess'))
}

const copyModelPricing = async () => {
  const data = {
    models: modelRates.value
      .filter((r) => r.model.trim())
      .map((r) => ({
        model: r.model.trim(),
        modelId: resolveModelId({ model: r.model, modelId: r.modelId }),
        pricingType: r.pricingType || 'token-based',
        inputPrice: r.inputPrice,
        outputPrice: r.outputPrice,
        fixedPrice: r.fixedPrice,
        cacheCreationMultiplier: r.cacheCreationMultiplier,
        cacheReadMultiplier: r.cacheReadMultiplier,
        supportedFormats: serializeSupportedFormats(r.supportedFormats),
      })),
  }

  const copied = await copyTextWithFallback(JSON.stringify(data, null, 2))
  if (copied) {
    ElMessage.success(i18ns.t('copySuccess'))
    return
  }

  ElMessage.error(i18ns.t('message.error.copyFailed'))
}

const addMonitorConfig = () => {
  monitorConfigs.value.push({
    monitorId: '',
    displayName: '',
  })
}

const addModelRate = () => {
  modelRates.value.push({
    model: '',
    modelId: '',
    pricingType: 'token-based',
    inputPrice: 10,
    outputPrice: 30,
    fixedPrice: 0,
    cacheCreationMultiplier: 1.25,
    cacheReadMultiplier: 0.1,
    supportedFormats: [],
  })
  editingRowIndex.value = modelRates.value.length - 1
}

// Height transition hooks — required because height: 0 → auto cannot be CSS-only
const onCollapseEnter = (el: Element) => {
  const e = el as HTMLElement
  e.style.height = '0'
  e.style.overflow = 'hidden'
  requestAnimationFrame(() => {
    e.style.height = e.scrollHeight + 'px'
  })
}
const onCollapseAfterEnter = (el: Element) => {
  const e = el as HTMLElement
  e.style.height = ''
  e.style.overflow = ''
}
const onCollapseLeave = (el: Element) => {
  const e = el as HTMLElement
  e.style.height = e.scrollHeight + 'px'
  e.style.overflow = 'hidden'
  requestAnimationFrame(() => {
    e.style.height = '0'
  })
}
const onCollapseAfterLeave = (el: Element) => {
  const e = el as HTMLElement
  e.style.height = ''
  e.style.overflow = ''
}

const isMobileSectionExpanded = (name: string) => mobileSections.value.includes(name)
const isMobileSectionLoaded = (name: string) => !!mobileSectionLoaded.value[name]
const ensureMobileSectionLoaded = (name: string) => {
  if (mobileSectionLoaded.value[name]) return
  if (heavySections.has(name)) {
    setTimeout(() => {
      mobileSectionLoaded.value[name] = true
    }, 16)
    return
  }
  mobileSectionLoaded.value[name] = true
}

const toggleMobileSection = (name: string) => {
  const next = new Set(mobileSections.value)
  if (next.has(name)) {
    next.delete(name)
  } else {
    ensureMobileSectionLoaded(name)
    next.add(name)
  }
  mobileSections.value = Array.from(next)
}

const handleImport = () => {
  try {
    const data = JSON.parse(importText.value)
    const models = data.models || data
    if (!Array.isArray(models)) {
      ElMessage.error(i18ns.t('ServerConfigView.importFormatError'))
      return
    }

    for (const item of models) {
      if (
        !item.model ||
        typeof item.inputPrice !== 'number' ||
        typeof item.outputPrice !== 'number'
      ) {
        ElMessage.error(i18ns.t('ServerConfigView.importFormatError'))
        return
      }
      // Validate pricingType
      if (
        item.pricingType &&
        item.pricingType !== 'token-based' &&
        item.pricingType !== 'per-request'
      ) {
        ElMessage.error(`Invalid pricingType for model ${item.model}`)
        return
      }
      // Validate fixedPrice for per-request models
      if (item.pricingType === 'per-request' && typeof item.fixedPrice !== 'number') {
        ElMessage.error(`fixedPrice is required for per-request model ${item.model}`)
        return
      }
    }

    // Merge: update existing models, add new ones
    const existingMap = new Map(modelRates.value.map((r) => [r.model.trim(), r]))
    for (const item of models) {
      const key = item.model.trim()
      if (existingMap.has(key)) {
        const existing = existingMap.get(key)!
        existing.pricingType = item.pricingType ?? existing.pricingType ?? 'token-based'
        existing.modelId =
          resolveModelId({
            model: item.model,
            modelId: item.modelId,
            provider: item.provider,
          }) || resolveModelId({ model: key, modelId: existing.modelId })
        existing.inputPrice = item.inputPrice
        existing.outputPrice = item.outputPrice
        existing.fixedPrice = item.fixedPrice ?? existing.fixedPrice
        existing.cacheCreationMultiplier =
          item.cacheCreationMultiplier ?? existing.cacheCreationMultiplier
        existing.cacheReadMultiplier = item.cacheReadMultiplier ?? existing.cacheReadMultiplier
        const formats = item.supportedFormats || existing.supportedFormats
        existing.supportedFormats = toSupportedFormatsArray(formats)
      } else {
        const formats = item.supportedFormats || 'all'
        modelRates.value.push({
          model: key,
          modelId:
            resolveModelId({ model: item.model, modelId: item.modelId, provider: item.provider }) ||
            key,
          pricingType: item.pricingType ?? 'token-based',
          inputPrice: item.inputPrice,
          outputPrice: item.outputPrice,
          fixedPrice: item.fixedPrice,
          cacheCreationMultiplier: item.cacheCreationMultiplier ?? 1.25,
          cacheReadMultiplier: item.cacheReadMultiplier ?? 0.1,
          supportedFormats: toSupportedFormatsArray(formats),
        })
      }
    }

    showImportDialog.value = false
    importText.value = ''
    ElMessage.success(i18ns.t('ServerConfigView.importSuccess'))
  } catch {
    ElMessage.error(i18ns.t('ServerConfigView.importFormatError'))
  }
}

// ========== Channel Management ==========
const channels = ref<RelayChannelDto[]>([])
const channelLoading = ref(false)
const channelSaving = ref(false)
const togglingChannelId = ref('')
const showChannelDialog = ref(false)
const showChannelImportDialog = ref(false)
const channelImportText = ref('')
const isEditingChannel = ref(false)
const editingChannelId = ref('')
const selectedChannelIds = ref<string[]>([])

const selectedChannels = computed(() => {
  const selectedIdSet = new Set(selectedChannelIds.value)
  return channels.value.filter((channel) => selectedIdSet.has(channel.id))
})

const hasChannelSelection = computed(() => selectedChannelIds.value.length > 0)

const isAllChannelsSelected = computed(
  () => channels.value.length > 0 && selectedChannelIds.value.length === channels.value.length,
)

const defaultChannelForm = () => ({
  name: '',
  openaiUpstreamUrl: '',
  openaiUpstreamApiKey: '',
  anthropicUpstreamUrl: '',
  anthropicUpstreamApiKey: '',
  geminiUpstreamUrl: '',
  geminiUpstreamApiKey: '',
  multiplier: 1.0,
  allowedFormats: [] as string[],
  allowedModelsArray: [] as string[],
  restrictModels: false, // 是否限制模型（false=允许所有，true=限制）
  inputTokensIncludeCacheRead: false, // 默认为 false
  modelMapping: {} as Record<string, string>,
  timePeriodMultipliers: [] as TimePeriodMultiplierRule[],
})

const channelForm = ref(defaultChannelForm())

// Time period multiplier rules
const timeRuleDialogVisible = ref(false)
const editingTimeRuleIndex = ref(-1)
const timeRuleFormRef = ref<FormInstance>()
const timeRuleDays = ref<number[]>([])
const timeRuleRange = ref<string[]>([])
const timeRuleForm = ref({
  name: '',
  multiplier: 1,
  enabled: true,
})
const timeRuleFormRules: FormRules = {
  name: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
  multiplier: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
  timeRange: [
    {
      validator: (_rule: unknown, _value: unknown, callback: (error?: Error) => void) => {
        if (
          !timeRuleRange.value ||
          timeRuleRange.value.length !== 2 ||
          !timeRuleRange.value[0] ||
          !timeRuleRange.value[1]
        ) {
          callback(new Error(i18ns.t('required')))
        } else {
          callback()
        }
      },
      trigger: 'change',
    },
  ],
}
const timeRuleDayOptions = [
  { value: 1, label: i18ns.t('relay.dayMon') },
  { value: 2, label: i18ns.t('relay.dayTue') },
  { value: 3, label: i18ns.t('relay.dayWed') },
  { value: 4, label: i18ns.t('relay.dayThu') },
  { value: 5, label: i18ns.t('relay.dayFri') },
  { value: 6, label: i18ns.t('relay.daySat') },
  { value: 7, label: i18ns.t('relay.daySun') },
]

function formatTimeRuleDays(dayOfWeek: string): string {
  if (!dayOfWeek || dayOfWeek.trim() === '') return i18ns.t('relay.allWeek')
  const days = dayOfWeek.split(',').map(Number)
  const names: string[] = []
  if (days.length === 5 && days.every((d) => [1, 2, 3, 4, 5].includes(d)))
    return i18ns.t('relay.weekday')
  if (days.length === 2 && days.includes(6) && days.includes(7)) return i18ns.t('relay.weekend')
  for (const d of days) {
    const opt = timeRuleDayOptions.find((o) => o.value === d)
    if (opt) names.push(opt.label)
  }
  return names.join(', ')
}

function resetTimeRuleForm() {
  timeRuleForm.value = { name: '', multiplier: 1, enabled: true }
  timeRuleDays.value = []
  timeRuleRange.value = []
  editingTimeRuleIndex.value = -1
}

function openAddTimeRule() {
  resetTimeRuleForm()
  timeRuleDialogVisible.value = true
}

function openEditTimeRule(index: number) {
  const rule = channelForm.value.timePeriodMultipliers[index]
  if (!rule) return
  editingTimeRuleIndex.value = index
  timeRuleForm.value = {
    name: rule.name,
    multiplier: rule.multiplier,
    enabled: rule.enabled,
  }
  timeRuleDays.value = rule.dayOfWeek ? rule.dayOfWeek.split(',').map(Number) : []
  timeRuleRange.value = [rule.startTime, rule.endTime]
  timeRuleDialogVisible.value = true
}

async function saveTimeRule() {
  const valid = await timeRuleFormRef.value?.validate().catch(() => false)
  if (!valid) return
  const rule: TimePeriodMultiplierRule = {
    name: timeRuleForm.value.name,
    dayOfWeek: timeRuleDays.value.join(','),
    startTime: timeRuleRange.value[0]!,
    endTime: timeRuleRange.value[1]!,
    multiplier: timeRuleForm.value.multiplier,
    enabled: timeRuleForm.value.enabled,
  }
  if (editingTimeRuleIndex.value >= 0) {
    channelForm.value.timePeriodMultipliers[editingTimeRuleIndex.value] = rule
  } else {
    channelForm.value.timePeriodMultipliers.push(rule)
  }
  timeRuleDialogVisible.value = false
}

function removeTimeRule(index: number) {
  channelForm.value.timePeriodMultipliers.splice(index, 1)
}

// 从后端获取的模型列表（包含完整信息）
const availableModels = ref<
  {
    model: string
    modelId: string
    supportedFormats?: string
  }[]
>([])

// 加载可用的模型列表
const loadAvailableModels = async () => {
  try {
    const relayConfig = await relayConfigService.getRelayConfig()
    availableModels.value = relayConfig.modelRates.map((m: RelayConfigModelRateItem) => {
      const modelName = (m.model || '').trim()
      const modelId = resolveModelId(m)
      return {
        model: modelName,
        modelId: modelId || modelName,
        supportedFormats: m.supportedFormats || 'all',
      }
    })
  } catch (error) {
    console.error('加载模型列表失败:', error)
  }
}

// 计算属性：根据选择的格式筛选可用的模型
const filteredModels = computed(() => {
  const selectedFormats = channelForm.value.allowedFormats

  if (!Array.isArray(selectedFormats) || selectedFormats.length === 0) {
    // 如果没有选择格式（空数组），显示所有模型
    return availableModels.value
  }

  // 筛选支持当前格式的模型
  return availableModels.value.filter((m) => {
    const formats = m.supportedFormats || 'all'
    if (formats === 'all') return true
    const modelFormats = formats.split(',').map((f: string) => f.trim())
    return selectedFormats.some((sf) => modelFormats.includes(sf))
  })
})

const formatModelOptionLabel = (model: { model: string; modelId: string }) => {
  const modelName = model.model.trim()
  const modelId = resolveModelId({ model: modelName, modelId: model.modelId })
  if (!modelName) return modelId
  if (!modelId || modelId === modelName) return modelName
  return `${modelName} (${modelId})`
}

// 判断模型是否应该被禁用（已选中相同 model ID 的其他模型）
const isModelDisabled = (model: { model: string; modelId: string }) => {
  const modelName = model.model.trim()
  const modelId = resolveModelId({ model: modelName, modelId: model.modelId })

  // 如果该模型已经被选中，不禁用（允许取消选择）
  if (channelForm.value.allowedModelsArray.includes(modelName)) {
    return false
  }

  // 检查是否有其他已选中的模型具有相同的 model ID
  for (const selectedModelName of channelForm.value.allowedModelsArray) {
    const selectedModelInfo = availableModels.value.find((m) => m.model === selectedModelName)
    if (!selectedModelInfo) continue

    const selectedModelId = resolveModelId({
      model: selectedModelInfo.model,
      modelId: selectedModelInfo.modelId,
    })

    if (selectedModelId === modelId) {
      return true
    }
  }

  return false
}

const computeShowUpstream = (formats: string[] | string | undefined, upstream: string) => {
  if (!formats) return false

  let fmts: string[] = []
  if (Array.isArray(formats)) {
    fmts = toConfiguredRelayFormats(formats)
  } else if (typeof formats === 'string') {
    fmts = normalizeRelayFormats(formats)
  }

  if (fmts.length === 0) return false

  return fmts.includes(upstream)
}

// 监听格式变化，自动清理不兼容的已选模型
watch(
  () => channelForm.value.allowedFormats,
  () => {
    if (!channelForm.value.allowedModelsArray.length) return

    // 获取当前格式下可用的模型列表
    const validModels = new Set(filteredModels.value.map((model) => model.model))

    // 过滤掉不兼容的模型
    channelForm.value.allowedModelsArray = channelForm.value.allowedModelsArray.filter((model) =>
      validModels.has(model),
    )
  },
)

// 解析 allowedModels JSON 字符串
const MAX_LOGGED_ALLOWED_MODEL_PARSE_ERRORS = 200
const loggedAllowedModelParseErrors = new Set<string>()
const hasShownAllowedModelsParseWarning = ref(false)

const parseAllowedModels = (allowedModels: string | null | undefined): string[] => {
  if (!allowedModels) return []
  try {
    const parsed = JSON.parse(allowedModels)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (!loggedAllowedModelParseErrors.has(allowedModels)) {
      if (loggedAllowedModelParseErrors.size >= MAX_LOGGED_ALLOWED_MODEL_PARSE_ERRORS) {
        const oldest = loggedAllowedModelParseErrors.values().next().value
        if (oldest !== undefined) loggedAllowedModelParseErrors.delete(oldest)
      }

      console.warn('Failed to parse channel allowedModels JSON in RelaySettingsView', {
        allowedModels,
        error,
      })
      loggedAllowedModelParseErrors.add(allowedModels)
    }

    if (!hasShownAllowedModelsParseWarning.value) {
      ElMessage.warning('Some channel model whitelist settings are invalid and were ignored.')
      hasShownAllowedModelsParseWarning.value = true
    }

    return []
  }
}

const syncSelectedChannelIds = () => {
  const validIds = new Set(channels.value.map((channel) => channel.id))
  selectedChannelIds.value = selectedChannelIds.value.filter((id) => validIds.has(id))
}

const isChannelSelected = (id: string) => selectedChannelIds.value.includes(id)

const toggleChannelSelection = (id: string, checked: boolean | string | number) => {
  const enabled = Boolean(checked)
  if (enabled) {
    if (!selectedChannelIds.value.includes(id)) {
      selectedChannelIds.value = [...selectedChannelIds.value, id]
    }
    return
  }

  selectedChannelIds.value = selectedChannelIds.value.filter((item) => item !== id)
}

const toggleAllChannels = (checked: boolean | string | number) => {
  selectedChannelIds.value = Boolean(checked) ? channels.value.map((channel) => channel.id) : []
}

// 模型名称列表（供 ModelMappingEditor 下拉选择使用，沿用"允许的模型"的计算结果）
const filteredModelNames = computed(() =>
  filteredModels.value
    .map((m) => m.model)
    .filter((name): name is string => typeof name === 'string' && name.length > 0),
)

const clearChannelSelection = () => {
  selectedChannelIds.value = []
}

const getChannelExportIds = () =>
  selectedChannelIds.value.length > 0
    ? selectedChannelIds.value
    : channels.value.map((channel) => channel.id)

const downloadJsonFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const buildChannelExportContent = async () => {
  const exportIds = getChannelExportIds()
  const response = await relayChannelService.exportChannels(
    exportIds.length > 0 ? { ids: exportIds, includeDisabled: true } : { includeDisabled: true },
  )

  return JSON.stringify(
    {
      channels: response.channels,
    },
    null,
    2,
  )
}

const exportChannelsAsJson = async () => {
  try {
    const content = await buildChannelExportContent()
    downloadJsonFile(`relay-channels-${new Date().toISOString().slice(0, 10)}.json`, content)
    ElMessage.success(i18ns.t('relay.channelExportSuccess'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('operationFailed'))
  }
}

const copyChannelsAsJson = async () => {
  try {
    const content = await buildChannelExportContent()
    const copied = await copyTextWithFallback(content)
    if (copied) {
      ElMessage.success(i18ns.t('copySuccess'))
      return
    }

    ElMessage.error(i18ns.t('copyFailed'))
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('operationFailed'))
  }
}

const openChannelImportDialog = () => {
  channelImportText.value = ''
  showChannelImportDialog.value = true
}

const handleImportChannels = async () => {
  let channelsToImport: RelayChannelImportItemDto[] = []
  try {
    const parsed = JSON.parse(channelImportText.value)
    const imported = parsed.channels ?? parsed
    if (!Array.isArray(imported)) {
      ElMessage.error(i18ns.t('relay.channelImportFormatError'))
      return
    }

    channelsToImport = imported.filter(
      (item): item is RelayChannelImportItemDto =>
        typeof item?.name === 'string' && item.name.trim().length > 0,
    )

    if (channelsToImport.length !== imported.length) {
      ElMessage.error(i18ns.t('relay.channelImportFormatError'))
      return
    }
  } catch {
    ElMessage.error(i18ns.t('relay.channelImportFormatError'))
    return
  }

  try {
    const result = await relayChannelService.importChannels({
      channels: channelsToImport,
    })
    ElMessage.success(i18ns.t('relay.channelImportSuccess', { count: result.created }))
    showChannelImportDialog.value = false
    channelImportText.value = ''
    await loadChannels()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('operationFailed'))
  }
}

const handleDuplicateChannel = async (row: RelayChannelDto) => {
  try {
    await relayChannelService.duplicateChannel(row.id)
    ElMessage.success(i18ns.t('relay.channelDuplicateSuccess'))
    await loadChannels()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('operationFailed'))
  }
}

const ensureChannelsSelected = () => {
  if (selectedChannelIds.value.length > 0) return true

  ElMessage.warning(i18ns.t('relay.selectChannelsFirst'))
  return false
}

const handleBatchDuplicateChannels = async () => {
  if (!ensureChannelsSelected()) return
  const count = selectedChannelIds.value.length

  try {
    await relayChannelService.batchDuplicateChannels(selectedChannelIds.value)
    ElMessage.success(i18ns.t('relay.channelBatchDuplicateSuccess', { count }))
    await loadChannels()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('operationFailed'))
  }
}

const handleBatchSetChannelStatus = async (enabled: boolean) => {
  if (!ensureChannelsSelected()) return
  const count = selectedChannelIds.value.length

  try {
    await ElMessageBox.confirm(
      i18ns.t('relay.confirmToggleStatus', {
        action: enabled
          ? i18ns.t('relay.batchEnableChannels')
          : i18ns.t('relay.batchDisableChannels'),
      }),
      i18ns.t('warning'),
      {
        type: 'warning',
      },
    )

    await relayChannelService.batchSetChannelStatus({
      ids: selectedChannelIds.value,
      enabled,
    })
    ElMessage.success(
      i18ns.t('relay.channelBatchStatusSuccess', {
        count,
        action: enabled ? i18ns.t('relay.enable') : i18ns.t('relay.disable'),
      }),
    )
    await loadChannels()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }
}

const handleBatchDeleteChannels = async () => {
  if (!ensureChannelsSelected()) return
  const count = selectedChannelIds.value.length

  try {
    await ElMessageBox.confirm(i18ns.t('relay.confirmBatchDeleteChannels'), i18ns.t('warning'), {
      type: 'warning',
    })
    await relayChannelService.batchDeleteChannels({
      ids: selectedChannelIds.value,
    })
    ElMessage.success(i18ns.t('relay.channelBatchDeleteSuccess', { count }))
    clearChannelSelection()
    await loadChannels()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }
}

const loadChannels = async () => {
  channelLoading.value = true
  try {
    channels.value = await relayChannelService.listChannels({ includeDisabled: true })
    syncSelectedChannelIds()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  } finally {
    channelLoading.value = false
  }
}

const openCreateChannelDialog = () => {
  isEditingChannel.value = false
  editingChannelId.value = ''
  channelForm.value = defaultChannelForm()
  showChannelDialog.value = true
}

const openEditChannelDialog = (row: RelayChannelDto) => {
  isEditingChannel.value = true
  editingChannelId.value = row.id
  const parsedModels = parseAllowedModels(row.allowedModels)
  channelForm.value = {
    name: row.name,
    openaiUpstreamUrl: row.openaiUpstreamUrl || '',
    openaiUpstreamApiKey: row.openaiUpstreamApiKey || '',
    anthropicUpstreamUrl: row.anthropicUpstreamUrl || '',
    anthropicUpstreamApiKey: row.anthropicUpstreamApiKey || '',
    geminiUpstreamUrl: row.geminiUpstreamUrl || '',
    geminiUpstreamApiKey: row.geminiUpstreamApiKey || '',
    multiplier: row.multiplier,
    allowedFormats: normalizeSupportedFormats(row.allowedFormats || 'all'),
    allowedModelsArray: parsedModels,
    restrictModels: row.allowedModels !== null && row.allowedModels !== undefined,
    inputTokensIncludeCacheRead: row.inputTokensIncludeCacheRead === true,
    modelMapping: (row.modelMapping as Record<string, string>) || {},
    timePeriodMultipliers: row.timePeriodMultipliers || [],
  }
  showChannelDialog.value = true
}

const handleSaveChannel = async () => {
  if (!channelForm.value.name) {
    ElMessage.error(i18ns.t('relay.channelName') + i18ns.t('relay.apiKeyRequired'))
    return
  }

  // 验证至少配置了一个上游
  if (
    !channelForm.value.openaiUpstreamUrl &&
    !channelForm.value.anthropicUpstreamUrl &&
    !channelForm.value.geminiUpstreamUrl
  ) {
    ElMessage.error(i18ns.t('relay.atLeastOneUpstream'))
    return
  }

  // Get selected formats (empty array means all formats)
  const formats =
    Array.isArray(channelForm.value.allowedFormats) && channelForm.value.allowedFormats.length > 0
      ? channelForm.value.allowedFormats
      : ['openai', 'anthropic', 'gemini']

  // 验证格式限制与上游配置的一致性
  if (formats.includes('openai')) {
    if (!channelForm.value.openaiUpstreamUrl) {
      ElMessage.error(i18ns.t('relay.openaiFormatNoUrl'))
      return
    }
    if (!channelForm.value.openaiUpstreamApiKey) {
      ElMessage.error(i18ns.t('relay.openaiFormatNoKey'))
      return
    }
  }
  if (formats.includes('anthropic')) {
    if (!channelForm.value.anthropicUpstreamUrl) {
      ElMessage.error(i18ns.t('relay.anthropicFormatNoUrl'))
      return
    }
    if (!channelForm.value.anthropicUpstreamApiKey) {
      ElMessage.error(i18ns.t('relay.anthropicFormatNoKey'))
      return
    }
  }
  if (formats.includes('gemini')) {
    if (!channelForm.value.geminiUpstreamUrl) {
      ElMessage.error(i18ns.t('relay.geminiFormatNoUrl'))
      return
    }
    if (!channelForm.value.geminiUpstreamApiKey) {
      ElMessage.error(i18ns.t('relay.geminiFormatNoKey'))
      return
    }
  }

  // For "all" format (empty array), validate that configured upstreams have API keys
  if (
    !Array.isArray(channelForm.value.allowedFormats) ||
    channelForm.value.allowedFormats.length === 0
  ) {
    if (channelForm.value.openaiUpstreamUrl && !channelForm.value.openaiUpstreamApiKey) {
      ElMessage.error(i18ns.t('relay.openaiUrlNoKey'))
      return
    }
    if (channelForm.value.anthropicUpstreamUrl && !channelForm.value.anthropicUpstreamApiKey) {
      ElMessage.error(i18ns.t('relay.anthropicUrlNoKey'))
      return
    }
    if (channelForm.value.geminiUpstreamUrl && !channelForm.value.geminiUpstreamApiKey) {
      ElMessage.error(i18ns.t('relay.geminiUrlNoKey'))
      return
    }
  }

  channelSaving.value = true
  try {
    const data = {
      name: channelForm.value.name,
      openaiUpstreamUrl: channelForm.value.openaiUpstreamUrl || undefined,
      openaiUpstreamApiKey: channelForm.value.openaiUpstreamApiKey || undefined,
      anthropicUpstreamUrl: channelForm.value.anthropicUpstreamUrl || undefined,
      anthropicUpstreamApiKey: channelForm.value.anthropicUpstreamApiKey || undefined,
      geminiUpstreamUrl: channelForm.value.geminiUpstreamUrl || undefined,
      geminiUpstreamApiKey: channelForm.value.geminiUpstreamApiKey || undefined,
      multiplier: channelForm.value.multiplier,
      // Convert array to comma-separated string, or 'all' if empty
      allowedFormats:
        Array.isArray(channelForm.value.allowedFormats) &&
        channelForm.value.allowedFormats.length > 0
          ? channelForm.value.allowedFormats.join(',')
          : 'all',
      allowedModels: channelForm.value.restrictModels
        ? JSON.stringify(channelForm.value.allowedModelsArray)
        : null,
      inputTokensIncludeCacheRead: channelForm.value.inputTokensIncludeCacheRead,
      modelMapping:
        channelForm.value.modelMapping && Object.keys(channelForm.value.modelMapping).length > 0
          ? channelForm.value.modelMapping
          : null,
      timePeriodMultipliers:
        channelForm.value.timePeriodMultipliers.length > 0
          ? channelForm.value.timePeriodMultipliers
          : null,
    }

    if (isEditingChannel.value) {
      await relayChannelService.updateChannel(editingChannelId.value, data)
    } else {
      await relayChannelService.createChannel(data)
    }

    ElMessage.success(
      isEditingChannel.value ? i18ns.t('relay.updateSuccess') : i18ns.t('relay.createSuccess'),
    )
    showChannelDialog.value = false
    await loadChannels()
    // 重新加载可用模型列表以更新下拉选项
    await loadAvailableModels()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.createFailed'))
  } finally {
    channelSaving.value = false
  }
}

const handleToggleChannelStatus = async (row: RelayChannelDto) => {
  try {
    const action = row.enabled ? i18ns.t('relay.disableChannel') : i18ns.t('relay.enableChannel')
    await ElMessageBox.confirm(
      i18ns.t('relay.confirmToggleStatus', { action }),
      i18ns.t('warning'),
      {
        type: 'warning',
      },
    )

    togglingChannelId.value = row.id
    await relayChannelService.toggleChannelStatus(row.id)
    ElMessage.success(i18ns.t('relay.updateSuccess'))
    await loadChannels()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  } finally {
    if (togglingChannelId.value === row.id) {
      togglingChannelId.value = ''
    }
  }
}

const handleDeleteChannel = async (row: RelayChannelDto) => {
  try {
    await ElMessageBox.confirm(i18ns.t('relay.confirmDeleteChannel'), i18ns.t('warning'), {
      type: 'warning',
    })
    await relayChannelService.deleteChannel(row.id)
    ElMessage.success(i18ns.t('relay.deleteSuccess'))
    loadChannels()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || i18ns.t('relay.deleteFailed'))
    }
  }
}

onMounted(() => {
  loadConfig()
  loadChannels()
  loadAvailableModels()
})

const { isDesktop } = usePageDevice()

// When switching between desktop/mobile, sync loaded state so already-expanded
// sections on one side are immediately visible on the other side.
watch(isDesktop, () => {
  const src = isDesktop.value ? mobileSections.value : desktopSections.value
  const targetLoaded = isDesktop.value ? desktopSectionLoaded : mobileSectionLoaded
  const targetSections = isDesktop.value ? desktopSections : mobileSections
  for (const name of src) {
    if (!targetLoaded.value[name]) {
      targetLoaded.value[name] = true
    }
    if (!targetSections.value.includes(name)) {
      targetSections.value = [...targetSections.value, name]
    }
  }
})
</script>

<style scoped>
/* Section collapse transition */
.section-collapse-enter-active {
  transition:
    height 0.26s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.22s ease;
  overflow: hidden;
}
.section-collapse-leave-active {
  transition:
    height 0.22s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.18s ease;
  overflow: hidden;
}
.section-collapse-enter-from,
.section-collapse-leave-to {
  height: 0 !important;
  opacity: 0;
}

.section-toggle-icon {
  display: inline-block;
  transform: rotate(-90deg);
  transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1);
}
.section-toggle-icon.is-expanded {
  transform: rotate(0deg);
}

.relay-settings {
  width: 100%;
}

.relay-settings-desktop {
  margin: 0 auto;
  padding: 20px;
}

.relay-settings :deep(.el-collapse) {
  border: none;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.relay-settings :deep(.el-collapse-item) {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-bg-color);
  overflow: hidden;
}

.relay-settings :deep(.el-collapse-item__header) {
  min-height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid transparent;
  background: transparent;
}

.relay-settings :deep(.el-collapse-item.is-active .el-collapse-item__header) {
  border-bottom-color: var(--el-border-color-lighter);
}

.relay-settings :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.relay-settings :deep(.el-collapse-item__content) {
  padding: 8px 16px 16px;
}

.relay-settings :deep(.el-form-item) {
  margin-bottom: 16px;
}

.relay-settings :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.relay-settings-desktop :deep(.el-form-item__label) {
  font-weight: 500;
}

.relay-settings-desktop :deep(.el-input),
.relay-settings-desktop :deep(.el-select),
.relay-settings-desktop :deep(.el-input-number) {
  max-width: 360px;
}

.collapse-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.form-help {
  display: block;
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.45;
  max-width: 680px;
}

.relay-settings-save-bar {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

:deep(.editing-row) {
  background-color: var(--el-color-primary-light-9) !important;
}
:deep(.el-table__row) {
  cursor: pointer;
}
:deep(.config-item-card .el-card__body) {
  padding: 12px;
}

.section-body {
  contain: style;
}

/* Mobile-only deep El overrides — scoped to mobile adapter only */
.relay-settings-mobile-adapter :deep(.hide-on-mobile) {
  display: none !important;
}
.relay-settings-mobile-adapter :deep(.el-form--inline) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.relay-settings-mobile-adapter :deep(.el-form-item),
.relay-settings-mobile-adapter :deep(.el-form--inline .el-form-item) {
  margin-right: 0;
  margin-bottom: 10px;
}
.relay-settings-mobile-adapter :deep(.el-form-item__label) {
  float: none;
  display: block;
  text-align: left;
  padding: 0 0 6px;
}
.relay-settings-mobile-adapter :deep(.el-form-item__content) {
  margin-left: 0 !important;
}
.relay-settings-mobile-adapter :deep(.el-input),
.relay-settings-mobile-adapter :deep(.el-select),
.relay-settings-mobile-adapter :deep(.el-date-editor),
.relay-settings-mobile-adapter :deep(.el-input-number),
.relay-settings-mobile-adapter :deep(.el-textarea) {
  width: 100%;
}
.relay-settings-mobile-adapter :deep(.el-input-number .el-input__wrapper),
.relay-settings-mobile-adapter :deep(.el-select__wrapper) {
  width: 100%;
}
.relay-settings-mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}
.relay-settings-mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 12px 14px;
}
.relay-settings-mobile-adapter :deep(.el-pagination) {
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}

/* Card interactive states — cannot be expressed in Tailwind */
.config-item-card {
  cursor: pointer;
  transition:
    box-shadow 0.2s,
    border-color 0.2s;
}
.config-item-card:active {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.config-item-card.is-editing {
  border-color: var(--el-color-primary-light-5) !important;
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
}

.config-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.config-item-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--el-text-color-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
