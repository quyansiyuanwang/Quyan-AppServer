<template>
  <div class="mobile-page relay-settings-mobile-adapter">
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
                        <el-checkbox v-model="showOnlyConfigured" class="mb-3">{{
                          i18ns.t('ServerConfigView.showOnlyConfigured')
                        }}</el-checkbox>
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
                                >{{ i18ns.t('delete') }}</el-button
                              >
                            </div>
                          </el-card>
                        </div>
                        <el-button size="small" class="mt-2 w-full" @click="addMonitorConfig">{{
                          i18ns.t('relay.addMonitorConfig')
                        }}</el-button>
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
              <span>{{ i18ns.t('ServerConfigView.requestQueueTitle') }}</span>
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
              @click="toggleMobileSection('customKey')"
            >
              <span>{{ i18ns.t('ServerConfigView.relayCustomKeyTitle') }}</span>
              <span
                :class="[
                  'section-toggle-icon',
                  { 'is-expanded': isMobileSectionExpanded('customKey') },
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
                v-if="isMobileSectionLoaded('customKey')"
                v-show="isMobileSectionExpanded('customKey')"
                class="section-body px-4 pb-4"
              >
                <el-form label-position="top" class="relay-settings-form">
                  <el-form-item
                    :label="i18ns.t('ServerConfigView.relayCustomKeyEnabled')"
                    class="setting-block"
                  >
                    <div
                      class="w-full border border-[var(--el-border-color-lighter)] rounded-xl p-3 bg-[var(--el-fill-color-blank)]"
                    >
                      <div class="flex items-center justify-between gap-2.5">
                        <span class="font-semibold text-[var(--el-text-color-primary)]">{{
                          i18ns.t('ServerConfigView.relayCustomKeyEnabled')
                        }}</span>
                        <el-switch v-model="relayCustomKeyEnabled" />
                      </div>
                    </div>
                    <span class="ml-3 text-[#909399] text-xs">{{
                      i18ns.t('ServerConfigView.relayCustomKeyEnabledHelp')
                    }}</span>
                  </el-form-item>
                  <el-form-item
                    :label="i18ns.t('ServerConfigView.relayCustomKeyMaxTokensPerUser')"
                    class="setting-block"
                  >
                    <el-input-number
                      v-model="relayCustomKeyMaxTokensPerUser"
                      :min="0"
                      :max="1000"
                      :disabled="!relayCustomKeyEnabled"
                    />
                    <span class="ml-3 text-[#909399] text-xs">{{
                      i18ns.t('ServerConfigView.relayCustomKeyMaxTokensPerUserHelp')
                    }}</span>
                  </el-form-item>
                  <el-form-item
                    :label="i18ns.t('ServerConfigView.relayCustomKeyCreateLimitWindowMinutes')"
                    class="setting-block"
                  >
                    <el-input-number
                      v-model="relayCustomKeyCreateLimitWindowMinutes"
                      :min="1"
                      :max="525600"
                      :disabled="!relayCustomKeyEnabled"
                    />
                    <span class="ml-3 text-[#909399] text-xs">{{
                      i18ns.t('ServerConfigView.relayCustomKeyCreateLimitWindowMinutesHelp')
                    }}</span>
                  </el-form-item>
                  <el-form-item
                    :label="i18ns.t('ServerConfigView.relayCustomKeyCreateLimitMaxCount')"
                    class="setting-block"
                  >
                    <el-input-number
                      v-model="relayCustomKeyCreateLimitMaxCount"
                      :min="0"
                      :max="100000"
                      :disabled="!relayCustomKeyEnabled"
                    />
                    <span class="ml-3 text-[#909399] text-xs">{{
                      i18ns.t('ServerConfigView.relayCustomKeyCreateLimitMaxCountHelp')
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
                                >{{ i18ns.t('delete') }}</el-button
                              >
                            </div>
                          </div>
                        </el-card>
                      </div>
                      <el-button size="small" class="mt-2 w-full" @click="addModelRate">{{
                        i18ns.t('ServerConfigView.addModel')
                      }}</el-button>
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
          <el-button type="primary" :loading="saving" @click="save">{{
            i18ns.t('save')
          }}</el-button>
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
      </el-card>

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
                <el-button type="primary" size="small" @click="openCreateChannelDialog">{{
                  i18ns.t('relay.createChannel')
                }}</el-button>
              </PermissionWrapper>
            </div>
            <div class="flex flex-wrap gap-2">
              <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                <el-button size="small" @click="openChannelImportDialog">{{
                  i18ns.t('relay.importChannels')
                }}</el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.RELAY_CHANNEL_EXPORT]">
                <el-button size="small" :loading="channelExporting" @click="exportChannelsAsJson">{{
                  i18ns.t('relay.exportChannels')
                }}</el-button>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.RELAY_CHANNEL_EXPORT]">
                <el-button size="small" :loading="channelExporting" @click="copyChannelsAsJson">{{
                  i18ns.t('relay.copyChannels')
                }}</el-button>
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
                  <el-tag v-if="selectedChannels.length" type="info" size="small">{{
                    i18ns.t('relay.selectedChannels', { count: selectedChannels.length })
                  }}</el-tag>
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
                      >{{ i18ns.t('relay.clearChannelSelection') }}</el-button
                    >
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_EXPORT]">
                    <el-button
                      size="small"
                      :disabled="!hasChannelSelection || channelExporting"
                      :loading="channelExporting"
                      @click="copyChannelsAsJson"
                      >{{ i18ns.t('relay.batchCopyChannels') }}</el-button
                    >
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
                    <el-button
                      size="small"
                      :disabled="!hasChannelSelection"
                      @click="handleBatchDuplicateChannels"
                      >{{ i18ns.t('relay.batchDuplicateChannels') }}</el-button
                    >
                  </PermissionWrapper>
                  <PermissionWrapper :require="[Permission.RELAY_CHANNEL_EXPORT]">
                    <el-button
                      size="small"
                      :disabled="!hasChannelSelection || channelExporting"
                      :loading="channelExporting"
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
                      <el-tag
                        :type="row.channelType === 'pooled' ? 'warning' : 'info'"
                        size="small"
                      >
                        {{ formatChannelTypeLabel(row.channelType) }}
                      </el-tag>
                      <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{
                        row.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled')
                      }}</el-tag>
                      <el-tag
                        v-if="!['pooled', 'automatic-proxy-pool'].includes(row.channelType)"
                        size="small"
                        type="primary"
                        >{{ row.multiplier }}x</el-tag
                      >
                    </div>
                  </div>
                  <div class="mt-3 flex flex-col gap-1.5">
                    <span
                      class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                      >{{ i18ns.t('relay.routingStrategy') }}</span
                    >
                    <div class="flex flex-wrap gap-2">
                      <el-tag v-if="row.channelType === 'pooled'" type="primary" size="small">{{
                        formatRoutingStrategyLabel(row.routingStrategy)
                      }}</el-tag>
                      <span v-else class="text-xs text-[var(--el-text-color-secondary)]">-</span>
                    </div>
                  </div>
                  <div class="mt-3 flex flex-col gap-1.5">
                    <span
                      class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                      >{{ i18ns.t('relay.visibilityMode') }}</span
                    >
                    <div class="flex flex-wrap gap-2">
                      <el-tooltip :content="getVisibilitySummary(row)" placement="top">
                        <el-tag
                          :type="
                            row.visibilityMode === 'public'
                              ? 'success'
                              : row.visibilityMode === 'private'
                                ? 'info'
                                : row.visibilityMode === 'hidden'
                                  ? 'warning'
                                  : 'danger'
                          "
                          size="small"
                        >
                          {{ formatVisibilityModeLabel(row.visibilityMode) }}
                        </el-tag>
                      </el-tooltip>
                    </div>
                  </div>
                  <div v-if="row.channelType === 'pooled'" class="mt-3 flex flex-col gap-1.5">
                    <span
                      class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                      >{{ i18ns.t('relay.poolMembers') }}</span
                    >
                    <div class="flex flex-wrap gap-2">
                      <el-tooltip
                        v-if="(row.poolMembers || []).length > 0"
                        :content="getPoolMembersSummary(row.poolMembers)"
                        placement="top"
                      >
                        <el-tag type="warning" size="small">
                          {{ (row.poolMembers || []).length }}
                          {{ i18ns.t('relay.poolMemberCount') }}
                        </el-tag>
                      </el-tooltip>
                      <el-tag v-else type="danger" size="small">{{
                        i18ns.t('relay.noPoolMembers')
                      }}</el-tag>
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
                          >OpenAI</el-tag
                        >
                        <el-tag
                          v-if="row.allowedFormats.includes('anthropic')"
                          type="warning"
                          size="small"
                          >Anthropic</el-tag
                        >
                        <el-tag
                          v-if="row.allowedFormats.includes('gemini')"
                          type="primary"
                          size="small"
                          >Gemini</el-tag
                        >
                      </template>
                    </div>
                  </div>
                  <div class="mt-3 flex flex-col gap-1.5">
                    <span
                      class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                      >{{ i18ns.t('relay.allowedModelsChannel') }}</span
                    >
                    <div class="flex flex-wrap gap-2">
                      <el-tag v-if="row.allowedModels.length === 0" type="danger" size="small">
                        {{ i18ns.t('relay.noModels') }}
                      </el-tag>
                      <el-tooltip v-else :content="row.allowedModels.join(', ')" placement="top">
                        <el-tag type="primary" size="small">
                          {{ getChannelAllowedModelsSummary(row) }}
                        </el-tag>
                      </el-tooltip>
                    </div>
                  </div>
                  <div class="mt-3 flex flex-col gap-1.5">
                    <span
                      class="text-xs font-semibold text-[var(--el-text-color-secondary)] leading-tight"
                      >{{ i18ns.t('relay.upstreamConfig') }}</span
                    >
                    <div
                      v-if="row.channelType === 'pooled'"
                      class="text-xs text-[var(--el-text-color-secondary)]"
                    >
                      {{ i18ns.t('relay.pooledNoDirectUpstreamHelp') }}
                    </div>
                    <div v-else class="flex flex-col gap-2">
                      <div
                        v-if="computeShowUpstream(row.allowedFormats, 'openai')"
                        class="flex items-start gap-2 text-xs text-[var(--el-text-color-regular)]"
                      >
                        <el-tag size="small" type="success">OpenAI</el-tag>
                        <span class="break-all">{{ row.openaiUpstreamUrl || '-' }}</span>
                      </div>
                      <div
                        v-if="computeShowUpstream(row.allowedFormats, 'anthropic')"
                        class="flex items-start gap-2 text-xs text-[var(--el-text-color-regular)]"
                      >
                        <el-tag size="small" type="warning">Anthropic</el-tag>
                        <span class="break-all">{{ row.anthropicUpstreamUrl || '-' }}</span>
                      </div>
                      <div
                        v-if="computeShowUpstream(row.allowedFormats, 'gemini')"
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
                    <PermissionWrapper :require="[Permission.RELAY_CHANNEL_READ]">
                      <el-button size="small" @click="openChannelDetailDialog(row)">{{
                        i18ns.t('button.viewDetails')
                      }}</el-button>
                    </PermissionWrapper>
                    <PermissionWrapper :require="[Permission.RELAY_CHANNEL_UPDATE]">
                      <el-button
                        size="small"
                        :type="row.enabled ? 'warning' : 'success'"
                        :loading="togglingChannelId === row.id"
                        @click="handleToggleChannelStatus(row)"
                        >{{
                          row.enabled ? i18ns.t('relay.disable') : i18ns.t('relay.enable')
                        }}</el-button
                      >
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
                  </div>
                </el-card>
              </div>
              <el-empty v-else />
            </div>
          </transition>
        </section>
      </el-card>
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
  toggleMobileSection,
  isMobileSectionExpanded,
  isMobileSectionLoaded,
  onCollapseEnter,
  onCollapseAfterEnter,
  onCollapseLeave,
  onCollapseAfterLeave,
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
  channelExporting,
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
  formatChannelTypeLabel,
  formatRoutingStrategyLabel,
  formatVisibilityModeLabel,
  getVisibilitySummary,
  getPoolMembersSummary,
  getChannelAllowedModelsSummary,
  togglingChannelId,
  handleToggleChannelStatus,
  openChannelDetailDialog,
  openEditChannelDialog,
  handleDuplicateChannel,
  handleDeleteChannel,
} = state
</script>
