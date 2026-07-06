<template>
  <div :class="isDesktop ? 'desktop-page' : 'mobile-page mobile-adapter'">
    <div class="api-doc-container">
      <el-card :class="isDesktop ? 'page-card' : 'mobile-card'">
        <template #header>
          <div class="card-header toolbar-row">
            <span>{{ i18ns.t('nav.apiDocumentation') }}</span>
            <div class="card-header-actions">
              <el-tag type="info" size="small">{{ i18ns.t('apiDoc.version') }}</el-tag>
              <el-button
                v-if="canOpenSwagger"
                type="primary"
                plain
                size="small"
                :loading="openingSwaggerDocs"
                @click="openSwaggerDocs"
              >
                {{ i18ns.t('apiDoc.openSwaggerDocs') }}
              </el-button>
            </div>
          </div>
        </template>

        <el-tabs v-model="activeTabName" @tab-change="handleTabChange">
          <el-tab-pane :label="i18ns.t('apiDoc.endpoints')" name="endpoints">
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                gap: 12px;
                flex-wrap: wrap;
              "
            >
              <el-alert type="info" :closable="false" style="flex: 1; min-width: 0">
                <template #title>
                  <strong>{{ i18ns.t('apiDoc.endpointNote') }}</strong>
                </template>
                {{ i18ns.t('apiDoc.endpointDesc') }}
              </el-alert>
              <div style="display: flex; align-items: center; gap: 8px; white-space: nowrap">
                <span style="font-size: 14px; color: var(--el-text-color-regular)">{{
                  i18ns.t('apiDoc.showFullEndpoint')
                }}</span>
                <el-switch v-model="showFullEndpoint" />
              </div>
            </div>

            <el-descriptions :column="1" border>
              <el-descriptions-item>
                <template #label>
                  <div class="label-with-icon">
                    <el-icon><Link /></el-icon>
                    <span>{{ i18ns.t('apiDoc.baseUrl') }}</span>
                  </div>
                </template>
                <div class="endpoint-content">
                  <el-text tag="code" class="endpoint-code">{{ aiBaseUrl }}</el-text>
                  <el-button
                    :icon="CopyDocument"
                    size="small"
                    @click="copyText(aiBaseUrl)"
                    type="primary"
                    text
                  />
                </div>
              </el-descriptions-item>

              <el-descriptions-item>
                <template #label>
                  <div class="label-with-icon">
                    <el-icon><Connection /></el-icon>
                    <span>{{ i18ns.t('apiDoc.openaiEndpoint') }}</span>
                  </div>
                </template>
                <div class="endpoint-content">
                  <el-text tag="code" class="endpoint-code">{{ displayOpenaiEndpoint }}</el-text>
                  <el-button
                    :icon="CopyDocument"
                    size="small"
                    @click="copyText(displayOpenaiEndpoint)"
                    type="primary"
                    text
                  />
                </div>
                <div class="endpoint-note">
                  {{ i18ns.t('apiDoc.openaiNote') }}
                </div>
              </el-descriptions-item>

              <el-descriptions-item>
                <template #label>
                  <div class="label-with-icon">
                    <el-icon><Connection /></el-icon>
                    <span>{{ i18ns.t('apiDoc.anthropicEndpoint') }}</span>
                  </div>
                </template>
                <div class="endpoint-content">
                  <el-text tag="code" class="endpoint-code">{{ displayAnthropicEndpoint }}</el-text>
                  <el-button
                    :icon="CopyDocument"
                    size="small"
                    @click="copyText(displayAnthropicEndpoint)"
                    type="primary"
                    text
                  />
                </div>
                <div class="endpoint-note">
                  {{ i18ns.t('apiDoc.anthropicNote') }}
                </div>
              </el-descriptions-item>

              <el-descriptions-item>
                <template #label>
                  <div class="label-with-icon">
                    <el-icon><Connection /></el-icon>
                    <span>{{ i18ns.t('apiDoc.geminiEndpoint') }}</span>
                  </div>
                </template>
                <div class="endpoint-content">
                  <el-text tag="code" class="endpoint-code">{{ displayGeminiEndpoint }}</el-text>
                  <el-button
                    :icon="CopyDocument"
                    size="small"
                    @click="copyText(displayGeminiEndpoint)"
                    type="primary"
                    text
                  />
                </div>
                <div class="endpoint-note">
                  {{ i18ns.t('apiDoc.geminiNote') }}
                </div>
              </el-descriptions-item>

              <el-descriptions-item>
                <template #label>
                  <div class="label-with-icon">
                    <el-icon><Connection /></el-icon>
                    <span>{{ i18ns.t('apiDoc.balanceEndpoint') }}</span>
                  </div>
                </template>
                <div class="endpoint-content">
                  <el-text tag="code" class="endpoint-code">{{ relayUsageEndpoint }}</el-text>
                  <el-button
                    :icon="CopyDocument"
                    size="small"
                    @click="copyText(relayUsageEndpoint)"
                    type="primary"
                    text
                  />
                </div>
                <div class="endpoint-note">
                  {{ i18ns.t('apiDoc.balanceNote') }}
                </div>
                <div style="margin-top: 12px">
                  <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px">
                    {{ i18ns.t('apiDoc.platformBalanceEndpoint') }}
                  </div>
                  <div class="endpoint-content">
                    <el-text tag="code" class="endpoint-code">{{
                      platformBalanceEndpoint
                    }}</el-text>
                    <el-button
                      :icon="CopyDocument"
                      size="small"
                      @click="copyText(platformBalanceEndpoint)"
                      type="primary"
                      text
                    />
                  </div>
                  <div class="endpoint-note">
                    {{ i18ns.t('apiDoc.platformBalanceNote') }}
                  </div>
                </div>
                <div style="margin-top: 16px">
                  <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px">
                    {{ i18ns.t('apiDoc.balanceResponseFields') }}
                  </div>
                  <el-alert type="info" :closable="false" style="margin-bottom: 12px">
                    {{ i18ns.t('apiDoc.balanceFieldsNote') }}
                  </el-alert>
                  <el-table :data="balanceFields" size="small" border stripe>
                    <el-table-column prop="field" :label="i18ns.t('field')" width="150">
                      <template #default="{ row }">
                        <el-text tag="code" type="primary">{{ row.field }}</el-text>
                      </template>
                    </el-table-column>
                    <el-table-column prop="description" :label="i18ns.t('description')">
                      <template #default="{ row }">
                        {{ row.description }}
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </el-descriptions-item>
            </el-descriptions>
          </el-tab-pane>

          <el-tab-pane :label="i18ns.t('apiDoc.pricing')" name="pricing" lazy>
            <template v-if="pricingTabActivated">
              <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
                <strong>{{ i18ns.t('apiDoc.pricingNote') }}</strong>
              </el-alert>

              <div :class="['pricing-toolbar', { 'pricing-toolbar--mobile': !isDesktop }]">
                <template v-if="isDesktop">
                  <el-select
                    v-model="filterFormat"
                    :placeholder="i18ns.t('apiDoc.filterByFormat')"
                    clearable
                    class="pricing-filter"
                  >
                    <el-option label="OpenAI" value="openai" />
                    <el-option label="Anthropic" value="anthropic" />
                    <el-option label="Gemini" value="gemini" />
                  </el-select>

                  <el-select
                    v-model="filterChannel"
                    :placeholder="i18ns.t('apiDoc.filterByChannel')"
                    clearable
                    filterable
                    class="pricing-filter"
                  >
                    <el-option
                      v-for="channel in channels"
                      :key="channel.id"
                      :label="channel.name"
                      :value="channel.id"
                    />
                  </el-select>

                  <div
                    v-if="filterChannel"
                    class="pricing-filter"
                    style="
                      display: flex;
                      align-items: center;
                      gap: 6px;
                      white-space: nowrap;
                      flex: none;
                      min-width: 0;
                    "
                  >
                    <el-switch v-model="showCalculatedPrice" :disabled="!filterChannel" />
                    <span style="font-size: 13px; color: var(--el-text-color-regular)">{{
                      i18ns.t('apiDoc.showCalculatedPrice')
                    }}</span>
                  </div>

                  <el-input
                    v-model="filterModelKeyword"
                    :placeholder="i18ns.t('apiDoc.filterByModelKeyword')"
                    :prefix-icon="Search"
                    clearable
                    class="pricing-filter"
                  />

                  <el-popover placement="bottom-start" trigger="click" :width="320">
                    <template #reference>
                      <el-button>
                        {{ i18ns.t('apiDoc.moreSettings') }}
                      </el-button>
                    </template>

                    <div class="pricing-more-settings-panel" @click.stop>
                      <div class="pricing-more-settings-item">
                        <span class="pricing-inline-label">{{
                          i18ns.t('apiDoc.customPriceMultiplier')
                        }}</span>
                        <el-input-number
                          v-model="customPriceMultiplier"
                          :min="0"
                          :step="0.01"
                          :precision="4"
                          class="pricing-multiplier-input"
                          controls-position="right"
                        />
                      </div>

                      <div class="pricing-more-settings-item pricing-more-settings-item--between">
                        <span class="pricing-inline-label">{{
                          i18ns.t('apiDoc.tokenPriceUnit')
                        }}</span>
                        <el-button class="pricing-unit-toggle" @click="toggleTokenPriceUnit">
                          {{ tokenPriceUnit }}
                        </el-button>
                      </div>

                      <div class="pricing-more-settings-item pricing-more-settings-item--between">
                        <span class="pricing-inline-label">{{
                          i18ns.t('apiDoc.showCacheMultipliers')
                        }}</span>
                        <el-switch v-model="showCacheMultipliers" />
                      </div>

                      <div class="pricing-more-settings-item pricing-more-settings-item--between">
                        <span class="pricing-inline-label">{{
                          i18ns.t('apiDoc.showLowestChannelPrice')
                        }}</span>
                        <el-switch v-model="showLowestChannelPrice" />
                      </div>

                      <el-checkbox v-model="onlyModelsWithChannels" class="pricing-checkbox">
                        {{ i18ns.t('apiDoc.onlyModelsWithChannels') }}
                      </el-checkbox>
                    </div>
                  </el-popover>

                  <template v-if="customMultiplierActive">
                    <el-tag
                      type="warning"
                      size="small"
                      effect="dark"
                      class="custom-multiplier-badge"
                    >
                      {{ i18ns.t('apiDoc.customMultiplierApplied') }}
                    </el-tag>
                  </template>

                  <el-button @click="handleResetFilters">{{ i18ns.t('reset') }}</el-button>

                  <el-button :icon="Refresh" @click="refreshData" :loading="loading" type="primary">
                    {{ i18ns.t('refresh') }}
                  </el-button>

                  <el-text type="info" size="small" class="toolbar-count">
                    {{ i18ns.t('apiDoc.showingModels', { count: filteredPricingData.length }) }}
                  </el-text>
                </template>

                <template v-else>
                  <div class="pricing-mobile-toolbar-header">
                    <el-text type="info" size="small" class="toolbar-count">
                      {{ i18ns.t('apiDoc.showingModels', { count: filteredPricingData.length }) }}
                    </el-text>

                    <div class="pricing-mobile-toolbar-actions">
                      <el-button
                        :icon="Refresh"
                        @click="refreshData"
                        :loading="loading"
                        type="primary"
                      >
                        {{ i18ns.t('refresh') }}
                      </el-button>
                      <el-button
                        :icon="mobilePricingControlsExpanded ? ArrowUp : ArrowDown"
                        @click="mobilePricingControlsExpanded = !mobilePricingControlsExpanded"
                      >
                        {{
                          mobilePricingControlsExpanded
                            ? i18ns.t('apiDoc.collapseFiltersAndSort')
                            : i18ns.t('apiDoc.expandFiltersAndSort')
                        }}
                      </el-button>
                    </div>
                  </div>

                  <el-collapse-transition>
                    <div v-show="mobilePricingControlsExpanded" class="pricing-mobile-panel">
                      <el-input
                        v-model="filterModelKeyword"
                        :placeholder="i18ns.t('apiDoc.filterByModelKeyword')"
                        :prefix-icon="Search"
                        clearable
                        class="pricing-filter"
                      />

                      <el-select
                        v-model="filterFormat"
                        :placeholder="i18ns.t('apiDoc.filterByFormat')"
                        clearable
                        class="pricing-filter"
                      >
                        <el-option label="OpenAI" value="openai" />
                        <el-option label="Anthropic" value="anthropic" />
                        <el-option label="Gemini" value="gemini" />
                      </el-select>

                      <el-select
                        v-model="filterChannel"
                        :placeholder="i18ns.t('apiDoc.filterByChannel')"
                        clearable
                        class="pricing-filter"
                      >
                        <el-option
                          v-for="channel in channels"
                          :key="channel.id"
                          :label="channel.name"
                          :value="channel.id"
                        />
                      </el-select>

                      <el-select
                        v-model="filterPricingType"
                        :placeholder="i18ns.t('apiDoc.filterByPricingType')"
                        clearable
                        class="pricing-filter"
                      >
                        <el-option :label="i18ns.t('apiDoc.tokenBased')" value="token-based" />
                        <el-option :label="i18ns.t('apiDoc.perRequest')" value="per-request" />
                      </el-select>

                      <el-select
                        v-model="mobileSortField"
                        :placeholder="i18ns.t('apiDoc.sortField')"
                        class="pricing-filter"
                      >
                        <el-option :label="i18ns.t('apiDoc.noSorting')" value="" />
                        <el-option :label="i18ns.t('apiDoc.model')" value="model" />
                        <el-option :label="i18ns.t('apiDoc.fixedPrice')" value="fixedPrice" />
                        <el-option :label="i18ns.t('apiDoc.inputPrice')" value="inputPrice" />
                        <el-option :label="i18ns.t('apiDoc.outputPrice')" value="outputPrice" />
                      </el-select>

                      <el-select
                        v-model="mobileSortOrder"
                        :placeholder="i18ns.t('apiDoc.sortOrder')"
                        :disabled="!mobileSortField"
                        class="pricing-filter"
                      >
                        <el-option :label="i18ns.t('apiDoc.sortAscending')" value="asc" />
                        <el-option :label="i18ns.t('apiDoc.sortDescending')" value="desc" />
                      </el-select>

                      <div v-if="filterChannel" class="pricing-mobile-switch">
                        <span class="pricing-mobile-switch-label">
                          {{ i18ns.t('apiDoc.showCalculatedPrice') }}
                        </span>
                        <el-switch v-model="showCalculatedPrice" :disabled="!filterChannel" />
                      </div>

                      <el-button
                        text
                        class="pricing-more-settings-toggle"
                        @click="
                          mobilePricingAdvancedSettingsExpanded =
                            !mobilePricingAdvancedSettingsExpanded
                        "
                      >
                        {{
                          mobilePricingAdvancedSettingsExpanded
                            ? i18ns.t('apiDoc.hideMoreSettings')
                            : i18ns.t('apiDoc.moreSettings')
                        }}
                      </el-button>

                      <el-collapse-transition>
                        <div
                          v-show="mobilePricingAdvancedSettingsExpanded"
                          class="pricing-mobile-advanced-panel"
                        >
                          <div class="pricing-inline-control pricing-inline-control--mobile">
                            <span class="pricing-inline-label">
                              {{ i18ns.t('apiDoc.customPriceMultiplier') }}
                            </span>
                            <el-input-number
                              v-model="customPriceMultiplier"
                              :min="0"
                              :step="0.01"
                              :precision="4"
                              class="pricing-multiplier-input"
                              controls-position="right"
                            />
                          </div>

                          <div class="pricing-mobile-switch">
                            <span class="pricing-mobile-switch-label">
                              {{ i18ns.t('apiDoc.showCacheMultipliers') }}
                            </span>
                            <el-switch v-model="showCacheMultipliers" />
                          </div>

                          <div class="pricing-inline-control pricing-inline-control--mobile">
                            <span class="pricing-inline-label">{{
                              i18ns.t('apiDoc.tokenPriceUnit')
                            }}</span>
                            <el-button
                              class="pricing-unit-toggle pricing-unit-toggle--mobile"
                              @click="toggleTokenPriceUnit"
                            >
                              {{ tokenPriceUnit }}
                            </el-button>
                          </div>

                          <div class="pricing-mobile-switch">
                            <span class="pricing-mobile-switch-label">
                              {{ i18ns.t('apiDoc.showLowestChannelPrice') }}
                            </span>
                            <el-switch v-model="showLowestChannelPrice" />
                          </div>

                          <el-checkbox v-model="onlyModelsWithChannels" class="pricing-checkbox">
                            {{ i18ns.t('apiDoc.onlyModelsWithChannels') }}
                          </el-checkbox>
                        </div>
                      </el-collapse-transition>

                      <div class="price-range-group">
                        <span class="price-range-label">{{ i18ns.t('apiDoc.fixedPrice') }}</span>
                        <el-input-number
                          v-model="fixedPriceMin"
                          :placeholder="i18ns.t('apiDoc.minPrice')"
                          :min="0"
                          :step="0.01"
                          :precision="4"
                          class="price-range-input"
                          controls-position="right"
                        />
                        <span class="price-range-separator">~</span>
                        <el-input-number
                          v-model="fixedPriceMax"
                          :placeholder="i18ns.t('apiDoc.maxPrice')"
                          :min="0"
                          :step="0.01"
                          :precision="4"
                          class="price-range-input"
                          controls-position="right"
                        />
                      </div>

                      <div class="price-range-group">
                        <span class="price-range-label">{{ i18ns.t('apiDoc.inputPrice') }}</span>
                        <el-input-number
                          v-model="inputPriceMin"
                          :placeholder="i18ns.t('apiDoc.minPrice')"
                          :min="0"
                          :step="0.01"
                          :precision="4"
                          class="price-range-input"
                          controls-position="right"
                        />
                        <span class="price-range-separator">~</span>
                        <el-input-number
                          v-model="inputPriceMax"
                          :placeholder="i18ns.t('apiDoc.maxPrice')"
                          :min="0"
                          :step="0.01"
                          :precision="4"
                          class="price-range-input"
                          controls-position="right"
                        />
                      </div>

                      <div class="price-range-group">
                        <span class="price-range-label">{{ i18ns.t('apiDoc.outputPrice') }}</span>
                        <el-input-number
                          v-model="outputPriceMin"
                          :placeholder="i18ns.t('apiDoc.minPrice')"
                          :min="0"
                          :step="0.01"
                          :precision="4"
                          class="price-range-input"
                          controls-position="right"
                        />
                        <span class="price-range-separator">~</span>
                        <el-input-number
                          v-model="outputPriceMax"
                          :placeholder="i18ns.t('apiDoc.maxPrice')"
                          :min="0"
                          :step="0.01"
                          :precision="4"
                          class="price-range-input"
                          controls-position="right"
                        />
                      </div>

                      <template v-if="customMultiplierActive">
                        <el-tag
                          type="warning"
                          size="small"
                          effect="dark"
                          style="justify-self: start"
                        >
                          {{ i18ns.t('apiDoc.customMultiplierApplied') }}
                        </el-tag>
                      </template>

                      <el-button @click="handleResetFilters">{{ i18ns.t('reset') }}</el-button>
                    </div>
                  </el-collapse-transition>
                </template>
              </div>

              <ComponentErrorBoundary>
                <ModelPricingTable
                  :rows="paginatedPricingData"
                  :loading="loading"
                  :error-message="loadErrorMessage"
                  :normalize-formats="normalizeFormats"
                  :get-request-model-id="getRequestModelId"
                  :get-highlight-parts="getHighlightParts"
                  :get-channels-for-model="getChannelsForModel"
                  :get-displayed-price-multiplier="getDisplayedPriceMultiplier"
                  :custom-price-multiplier="customPriceMultiplier"
                  :custom-multiplier-active="customMultiplierActive"
                  :show-cache-multipliers="showCacheMultipliers"
                  :token-price-unit="tokenPriceUnit"
                  :price-ranges="priceRanges"
                  :on-copy-model-id="copyText"
                  :display-mode="priceDisplayMode"
                  :selected-channel="selectedChannel"
                  :pricing-type-filter="filterPricingType"
                  :on-price-range-change="handlePriceRangeChange"
                  :on-price-range-reset="resetPriceRangeFilter"
                  :on-pricing-type-filter-change="handlePricingTypeFilterChange"
                  :sort-field="sortField"
                  :sort-order="sortOrder"
                  :on-sort-change="handleSortChange"
                />
              </ComponentErrorBoundary>

              <div class="pricing-pagination-row">
                <el-pagination
                  v-model:current-page="currentPage"
                  v-model:page-size="pageSize"
                  :total="filteredPricingData.length"
                  :page-sizes="pageSizeOptions"
                  background
                  layout="total, sizes, prev, pager, next, jumper"
                />
              </div>
            </template>
          </el-tab-pane>

          <el-tab-pane :label="i18ns.t('apiDoc.tutorial')" name="tutorial">
            <el-steps direction="vertical" :active="5" finish-status="success">
              <el-step :title="i18ns.t('apiDoc.step1Title')">
                <template #description>
                  <div class="step-content">
                    <p>{{ i18ns.t('apiDoc.step1Desc') }}</p>
                    <el-button
                      type="primary"
                      size="small"
                      @click="router.push({ name: 'relayTokenManagement' })"
                    >
                      {{ i18ns.t('apiDoc.goToTokens') }}
                    </el-button>
                  </div>
                </template>
              </el-step>
              <el-step :title="i18ns.t('apiDoc.step2Title')">
                <template #description>
                  <div class="step-content">
                    <p>{{ i18ns.t('apiDoc.step2Desc') }}</p>
                    <div class="endpoint-content">
                      <el-text tag="code" class="endpoint-code">{{
                        displayAnthropicEndpoint
                      }}</el-text>
                      <el-button
                        :icon="CopyDocument"
                        size="small"
                        @click="copyText(displayAnthropicEndpoint)"
                        type="primary"
                        text
                      />
                    </div>
                  </div>
                </template>
              </el-step>
              <el-step :title="i18ns.t('apiDoc.step3Title')">
                <template #description>
                  <div class="step-content">
                    <p>{{ i18ns.t('apiDoc.step3Desc') }}</p>
                    <div class="code-example">
                      <pre>Authorization: Bearer YOUR_TOKEN_HERE</pre>
                    </div>
                  </div>
                </template>
              </el-step>
              <el-step :title="i18ns.t('apiDoc.step4Title')">
                <template #description>
                  <div class="step-content">
                    {{ i18ns.t('apiDoc.step4Desc') }}
                  </div>
                </template>
              </el-step>
              <el-step :title="i18ns.t('apiDoc.step5Title')">
                <template #description>
                  <div class="step-content">
                    <div class="step-content">
                      <p>{{ i18ns.t('apiDoc.step5Desc1') }}</p>
                      <div class="endpoint-content">
                        <el-text tag="code" class="endpoint-code">{{
                          platformBalanceEndpoint
                        }}</el-text>
                        <el-button
                          :icon="CopyDocument"
                          size="small"
                          @click="copyText(platformBalanceEndpoint)"
                          type="primary"
                          text
                        />
                      </div>
                    </div>
                    <p>{{ i18ns.t('apiDoc.step5Desc2') }}</p>
                    <p>{{ i18ns.t('apiDoc.step5Desc3') }}</p>
                    <div class="endpoint-content">
                      <el-text tag="code" class="endpoint-code">{{ relayUsageEndpoint }}</el-text>
                      <el-button
                        :icon="CopyDocument"
                        size="small"
                        @click="copyText(relayUsageEndpoint)"
                        type="primary"
                        text
                      />
                    </div>
                    <el-button
                      type="primary"
                      size="small"
                      @click="router.push({ name: 'settingsSecurity' })"
                    >
                      {{ i18ns.t('apiDoc.goToAccessKeys') }}
                    </el-button>
                    <div style="margin-top: 16px; display: flex; align-items: center; gap: 8px">
                      <p style="font-weight: 600; margin: 0">
                        {{ i18ns.t('apiDoc.ccswitchTemplate') }}:
                      </p>
                      <el-button
                        :icon="CopyDocument"
                        size="small"
                        @click="copyText(ccswitchBalanceSample)"
                        type="primary"
                        text
                      >
                        {{ i18ns.t('button.copy') }}
                      </el-button>
                    </div>
                    <div class="code-example">
                      <pre>{{ ccswitchBalanceSample }}</pre>
                    </div>
                  </div>
                </template>
              </el-step>
            </el-steps>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMobileTableCardLabels } from '@/composables/useMobileTableCardLabels'
import {
  type PriceRangeField,
  useApiDocumentationPricing,
  type PricingSortField,
  type PricingSortOrder,
} from '@/composables/useApiDocumentationPricing'
import { usePageDevice } from '@/composables/usePageDevice'
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { i18ns } from '@/locales'
import router from '@/router'
import { swaggerDocsService } from '@/service/swaggerDocsService'
import { usePermissionStore } from '@/stores/permissionStore'
import {
  ArrowDown,
  ArrowUp,
  Connection,
  CopyDocument,
  Link,
  Refresh,
  Search,
} from '@element-plus/icons-vue'
import ComponentErrorBoundary from '@/components/common/ComponentErrorBoundary.vue'
import ModelPricingTable from '@/components/relay/ModelPricingTable.vue'
import {
  buildRelayUsageEndpointUrl,
  CCSWITCH_BALANCE_SAMPLE,
  resolveRelayAiBaseUrl,
} from '@/constant/strings'
import { Permission } from '@/constant/permission'

const baseUrl = computed(() => String(import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, ''))
const permissionStore = usePermissionStore()
const aiBaseUrl = computed(() =>
  resolveRelayAiBaseUrl(
    import.meta.env.VITE_RELAY_PUBLIC_BASE_URL,
    import.meta.env.VITE_AI_PROXY_URL,
  ),
)
const swaggerDocsBaseUrl = computed(() => (baseUrl.value ? `${baseUrl.value}/docs` : '/docs'))
const relayUsageEndpoint = computed(() =>
  buildRelayUsageEndpointUrl({
    relayPublicBaseUrl: import.meta.env.VITE_RELAY_PUBLIC_BASE_URL,
    aiProxyUrl: import.meta.env.VITE_AI_PROXY_URL,
    backendBaseUrl: import.meta.env.VITE_BACKEND_URL,
  }),
)
const platformBalanceEndpoint = computed(() =>
  baseUrl.value ? `${baseUrl.value}/v1/balance/usage` : '/v1/balance/usage',
)
const ccswitchBalanceSample = computed(() =>
  CCSWITCH_BALANCE_SAMPLE.replace('{{usageEndpoint}}', relayUsageEndpoint.value),
)
const canOpenSwagger = computed(() => permissionStore.hasPermission(Permission.DEBUG_OPENAPI_READ))
const openingSwaggerDocs = ref(false)
const showFullEndpoint = ref(false)
const activeTabName = ref<'endpoints' | 'pricing' | 'tutorial'>('endpoints')
const pricingTabActivated = ref(false)
const mobilePricingControlsExpanded = ref(false)
const mobilePricingAdvancedSettingsExpanded = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const pageSizeOptions = [20, 50, 100, 200]

// 计算显示的端点地址
const displayOpenaiEndpoint = computed(() =>
  showFullEndpoint.value ? `${aiBaseUrl.value}/v1/chat/completions` : `${aiBaseUrl.value}/v1`,
)
const displayAnthropicEndpoint = computed(() =>
  showFullEndpoint.value ? `${aiBaseUrl.value}/v1/messages` : aiBaseUrl.value,
)
const displayGeminiEndpoint = computed(() =>
  showFullEndpoint.value
    ? `${aiBaseUrl.value}/v1beta/models/{model}/generateContent`
    : `${aiBaseUrl.value}/v1beta`,
)

const {
  loading,
  loadErrorMessage,
  channels,
  filterFormat,
  filterChannel,
  filterPricingType,
  filterModelKeyword,
  onlyModelsWithChannels,
  showCalculatedPrice,
  showLowestChannelPrice,
  customPriceMultiplier,
  tokenPriceUnit,
  fixedPriceMin,
  fixedPriceMax,
  inputPriceMin,
  inputPriceMax,
  outputPriceMin,
  outputPriceMax,
  sortField,
  sortOrder,
  filteredPricingData,
  priceDisplayMode,
  normalizeFormats,
  getRequestModelId,
  getChannelsForModel,
  getDisplayedPriceMultiplier,
  getHighlightParts,
  toggleTokenPriceUnit,
  resetFilters,
  refreshData,
  copyText,
} = useApiDocumentationPricing()

const showCacheMultipliers = ref(false)

const customMultiplierActive = computed(
  () => customPriceMultiplier.value !== null && customPriceMultiplier.value !== 1,
)

const selectedChannel = computed(() =>
  filterChannel.value ? (channels.value.find((c) => c.id === filterChannel.value) ?? null) : null,
)

const mobileSortField = computed<PricingSortField>({
  get: () => sortField.value || '',
  set: (value) => {
    sortField.value = value

    if (!value) {
      sortOrder.value = ''
      return
    }

    if (!sortOrder.value) {
      sortOrder.value = 'asc'
    }

    currentPage.value = 1
  },
})

const mobileSortOrder = computed<PricingSortOrder>({
  get: () => sortOrder.value || '',
  set: (value) => {
    if (!mobileSortField.value) {
      sortOrder.value = ''
      return
    }

    sortOrder.value = value

    if (!value) {
      sortField.value = ''
    }

    currentPage.value = 1
  },
})

const priceRanges = computed(() => ({
  fixedPrice: {
    min: fixedPriceMin.value,
    max: fixedPriceMax.value,
  },
  inputPrice: {
    min: inputPriceMin.value,
    max: inputPriceMax.value,
  },
  outputPrice: {
    min: outputPriceMin.value,
    max: outputPriceMax.value,
  },
}))

const paginatedPricingData = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredPricingData.value.slice(start, start + pageSize.value)
})

const balanceFields = computed(() => [
  { field: i18ns.t('apiDoc.fieldIsValid'), description: i18ns.t('apiDoc.fieldIsValidDesc') },
  {
    field: i18ns.t('apiDoc.fieldInvalidMessage'),
    description: i18ns.t('apiDoc.fieldInvalidMessageDesc'),
  },
  { field: i18ns.t('apiDoc.fieldRemaining'), description: i18ns.t('apiDoc.fieldRemainingDesc') },
  { field: i18ns.t('apiDoc.fieldUnit'), description: i18ns.t('apiDoc.fieldUnitDesc') },
  { field: i18ns.t('apiDoc.fieldPlanName'), description: i18ns.t('apiDoc.fieldPlanNameDesc') },
  { field: i18ns.t('apiDoc.fieldTotal'), description: i18ns.t('apiDoc.fieldTotalDesc') },
  { field: i18ns.t('apiDoc.fieldUsed'), description: i18ns.t('apiDoc.fieldUsedDesc') },
  { field: i18ns.t('apiDoc.fieldExtra'), description: i18ns.t('apiDoc.fieldExtraDesc') },
])

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

const ensurePricingTabReady = async () => {
  if (pricingTabActivated.value) return
  pricingTabActivated.value = true
  await refreshData()
}

const handleTabChange = async (name: string | number) => {
  if (name === 'pricing') {
    await ensurePricingTabReady()
    return
  }
}

const handleSortChange = (field: PricingSortField, order: PricingSortOrder) => {
  sortField.value = field
  sortOrder.value = order
  currentPage.value = 1
}

const handlePricingTypeFilterChange = (value: string) => {
  filterPricingType.value = value
  currentPage.value = 1
}

const handlePriceRangeChange = (
  field: PriceRangeField,
  bound: 'min' | 'max',
  value: number | null,
) => {
  const normalizedValue = typeof value === 'number' ? value : null

  if (field === 'fixedPrice') {
    if (bound === 'min') fixedPriceMin.value = normalizedValue
    else fixedPriceMax.value = normalizedValue
    return
  }

  if (field === 'inputPrice') {
    if (bound === 'min') inputPriceMin.value = normalizedValue
    else inputPriceMax.value = normalizedValue
    return
  }

  if (bound === 'min') outputPriceMin.value = normalizedValue
  else outputPriceMax.value = normalizedValue
}

const resetPriceRangeFilter = (field: PriceRangeField) => {
  if (field === 'fixedPrice') {
    fixedPriceMin.value = null
    fixedPriceMax.value = null
    return
  }

  if (field === 'inputPrice') {
    inputPriceMin.value = null
    inputPriceMax.value = null
    return
  }

  outputPriceMin.value = null
  outputPriceMax.value = null
}

const handleResetFilters = () => {
  resetFilters()
  currentPage.value = 1
}

const openSwaggerDocs = async () => {
  if (openingSwaggerDocs.value) return

  const previewWindow = window.open('', '_blank')

  if (previewWindow) {
    try {
      previewWindow.opener = null
    } catch {
      // Ignore browser restrictions while keeping the popup alive for user-gesture navigation.
    }
  }

  openingSwaggerDocs.value = true

  try {
    const handoff = await swaggerDocsService.generateAccessLink(60)
    const targetUrl = swaggerDocsService.buildDocsUrl(swaggerDocsBaseUrl.value, handoff.reurl)

    if (previewWindow && !previewWindow.closed) {
      previewWindow.location.replace(targetUrl)
      previewWindow.focus()
      return
    }

    window.location.assign(targetUrl)
  } catch (error) {
    previewWindow?.close()
    ElMessage.error(toErrorMessage(error, i18ns.t('apiDoc.openSwaggerDocsFailed')))
  } finally {
    openingSwaggerDocs.value = false
  }
}

onMounted(() => {
  void permissionStore.init()

  if (activeTabName.value === 'pricing') {
    void ensurePricingTabReady()
    return
  }
})

const { isDesktop } = usePageDevice()

if (!isDesktop.value) {
  useMobileTableCardLabels('.mobile-adapter')
}

watch(filteredPricingData, () => {
  const totalPages = Math.max(1, Math.ceil(filteredPricingData.value.length / pageSize.value))
  if (currentPage.value > totalPages) {
    currentPage.value = totalPages
  }
})

watch(
  [
    filterFormat,
    filterChannel,
    filterPricingType,
    filterModelKeyword,
    onlyModelsWithChannels,
    showCalculatedPrice,
    showLowestChannelPrice,
    fixedPriceMin,
    fixedPriceMax,
    inputPriceMin,
    inputPriceMax,
    outputPriceMin,
    outputPriceMax,
  ],
  () => {
    currentPage.value = 1
  },
)

watch(pageSize, () => {
  currentPage.value = 1
})
</script>

<style scoped>
.api-doc-container {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.toolbar-row {
  gap: 12px;
  flex-wrap: wrap;
}

.card-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.label-with-icon {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.endpoint-content {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.endpoint-code {
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: break-all;
}

.endpoint-note {
  margin-top: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.model-cell {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px;
}

.pricing-toolbar {
  margin-bottom: 16px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-blank);
}

.pricing-toolbar--mobile {
  gap: 10px;
}

.pricing-mobile-toolbar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pricing-mobile-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pricing-mobile-panel {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.pricing-mobile-advanced-panel {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.pricing-filter {
  flex: 1 1 140px;
  min-width: 120px;
}

.custom-multiplier-badge {
  flex: none;
}

.pricing-more-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pricing-more-settings-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pricing-more-settings-item--between {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pricing-inline-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pricing-inline-control--mobile {
  align-items: stretch;
  flex-direction: column;
}

.pricing-inline-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.5;
}

.pricing-multiplier-input {
  width: 160px;
  max-width: 100%;
}

.pricing-unit-toggle {
  min-width: 120px;
}

.pricing-unit-toggle--mobile {
  width: 100%;
}

.pricing-checkbox {
  margin-top: 4px;
}

.toolbar-count {
  margin-left: auto;
  white-space: nowrap;
}

.pricing-mobile-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pricing-mobile-switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.5;
}

.pricing-more-settings-toggle {
  justify-content: flex-start;
  padding-left: 0;
}

.price-range-group {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.price-range-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}

.price-range-input {
  width: 100%;
}

.price-range-separator {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.pricing-pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.monthly-pass-doc-entry-card {
  border-radius: 18px;
}

.monthly-pass-doc-entry-card__content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.monthly-pass-doc-entry-card__title {
  font-size: 18px;
  font-weight: 700;
}

.monthly-pass-doc-entry-card__desc {
  margin-top: 8px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.monthly-pass-doc-entry-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.highlight-match {
  background: #ffe58f;
  color: inherit;
  border-radius: 3px;
  padding: 0 2px;
}

.pricing-table :deep(.el-table__header th) {
  background: var(--el-fill-color-light);
  font-weight: 600;
}

.pricing-table :deep(.el-table__row td) {
  vertical-align: top;
}

.pricing-table :deep(.el-table__cell) {
  padding-top: 12px;
  padding-bottom: 12px;
}

.pricing-table :deep(.cell) {
  line-height: 1.45;
}

.pricing-table :deep(.el-link) {
  font-weight: 600;
}

.pricing-table :deep(.el-tag + .el-tag) {
  margin-left: 6px;
}

.channels-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  align-content: flex-start;
  min-height: 28px;
}

.step-content {
  margin-top: 8px;
  line-height: 1.8;
}

.step-content p {
  margin-bottom: 12px;
  color: var(--el-text-color-regular);
}

.code-block {
  display: block;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  margin-top: 8px;
}

.code-example {
  margin-top: 8px;
  padding: 12px;
  background: var(--el-fill-color-darker);
  border-radius: 4px;
  border-left: 3px solid var(--el-color-primary);
  overflow-x: auto;
}

.code-example pre {
  margin: 0;
  font-family: 'Courier New', monospace;
  color: var(--el-text-color-primary);
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
}

:deep(.el-descriptions__label) {
  width: 200px;
  vertical-align: middle;
}

:deep(.el-descriptions__content) {
  min-width: 0;
  max-width: 0;
  width: 100%;
  overflow: hidden;
}

:deep(.el-descriptions__body) {
  table-layout: fixed;
  width: 100%;
}

:deep(.el-step__description) {
  padding-right: 20px;
  overflow: hidden;
  word-break: break-word;
}
</style>

<style scoped>
.mobile-adapter {
  padding: 8px 6px 14px;
  overflow-x: hidden;
}

.mobile-adapter :deep(.hide-on-mobile),
.mobile-adapter :deep(.el-table__header-wrapper),
.mobile-adapter :deep(.el-table__fixed-right-patch) {
  display: none !important;
}

.mobile-adapter :deep(.el-card__header) {
  padding: 12px 14px;
}

.mobile-adapter :deep(.el-card__body) {
  padding: 12px;
}

.mobile-adapter :deep(.card-header),
.mobile-adapter :deep(.endpoint-content) {
  flex-wrap: wrap;
  gap: 8px;
}

.mobile-adapter :deep(.endpoint-content) {
  flex-direction: column;
  align-items: stretch;
}

.mobile-adapter :deep(.endpoint-code),
.mobile-adapter :deep(.code-example pre) {
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
}

.mobile-adapter :deep(.el-tabs__nav-wrap) {
  overflow-x: auto;
}

.mobile-adapter :deep(.pricing-toolbar),
.mobile-adapter :deep(.el-form--inline) {
  display: grid !important;
  grid-template-columns: 1fr;
  gap: 8px !important;
}

.mobile-adapter :deep(.pricing-toolbar) {
  padding: 10px;
  border-radius: 10px;
}

.mobile-adapter :deep(.pricing-mobile-toolbar-header) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.mobile-adapter :deep(.pricing-mobile-toolbar-actions) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.mobile-adapter :deep(.pricing-mobile-panel) {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.mobile-adapter :deep(.toolbar-count) {
  margin-left: 0;
}

.mobile-adapter :deep(.pricing-filter) {
  width: 100% !important;
}

.mobile-adapter :deep(.pricing-multiplier-input) {
  width: 100% !important;
}

.mobile-adapter :deep(.price-range-group),
.mobile-adapter :deep(.price-range-input),
.mobile-adapter :deep(.price-range-group .el-input-number) {
  width: 100% !important;
}

.mobile-adapter :deep(.price-range-group) {
  display: grid !important;
  grid-template-columns: 1fr;
  gap: 6px !important;
}

.mobile-adapter :deep(.price-range-separator) {
  display: none;
}

.mobile-adapter :deep(.pricing-table .model-cell) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.mobile-adapter :deep(.pricing-table .channels-cell) {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.mobile-adapter :deep(.pricing-table .model-cell .el-link) {
  font-size: 14px;
  line-height: 1.45;
}

.mobile-adapter :deep(.pricing-table .channels-cell .el-tag),
.mobile-adapter :deep(.pricing-table td[data-label='Supported Formats'] .el-tag),
.mobile-adapter :deep(.pricing-table td[data-label='支持格式'] .el-tag) {
  margin: 0 !important;
}

.mobile-adapter :deep(.pricing-toolbar .el-select),
.mobile-adapter :deep(.pricing-toolbar .el-date-editor),
.mobile-adapter :deep(.pricing-toolbar .el-button),
.mobile-adapter :deep(.el-form-item),
.mobile-adapter :deep(.el-form-item__content) {
  width: 100% !important;
  margin: 0 !important;
}

.mobile-adapter :deep(.pricing-mobile-toolbar-actions .el-button) {
  width: 100% !important;
}

.mobile-adapter :deep(.el-form-item__label) {
  padding: 0 0 6px;
}

.mobile-adapter :deep(.el-table),
.mobile-adapter :deep(.el-table__inner-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__wrap),
.mobile-adapter :deep(.el-table__body-wrapper .el-scrollbar__view) {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  border: none !important;
  overflow-x: hidden !important;
}

.mobile-adapter :deep(.el-table::before),
.mobile-adapter :deep(.el-table__inner-wrapper::before),
.mobile-adapter :deep(.el-scrollbar__bar.is-horizontal),
.mobile-adapter :deep(.el-table__body colgroup),
.mobile-adapter :deep(.el-table__header colgroup) {
  display: none !important;
}

.mobile-adapter :deep(.el-table__body),
.mobile-adapter :deep(.el-table__body tbody),
.mobile-adapter :deep(.el-table__body tr),
.mobile-adapter :deep(.el-table__body td),
.mobile-adapter :deep(.el-table__body td .cell) {
  width: 100% !important;
  box-sizing: border-box;
}

.mobile-adapter :deep(.el-table__body tbody) {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 0 8px;
}

.mobile-adapter :deep(.el-table__body tr) {
  display: block;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 0 !important;
  background: var(--el-fill-color-blank);
}

.mobile-adapter :deep(.el-table__body td) {
  display: block;
  border: none !important;
  padding: 6px 0;
}

.mobile-adapter :deep(.el-table .cell) {
  line-height: 1.35;
  white-space: normal;
  word-break: break-word;
  padding: 0 !important;
}

.mobile-adapter :deep(.el-table__body td::before) {
  content: attr(data-label);
  display: block;
  margin-bottom: 4px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
}

.mobile-adapter :deep(.pricing-table .el-text[tag='b']) {
  font-size: 14px;
  font-weight: 700;
}

.mobile-adapter :deep(.pricing-table td) {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.mobile-adapter :deep(.pricing-table td::before) {
  flex: 0 0 92px;
  margin-bottom: 0;
  padding-top: 1px;
  text-align: left;
}

.mobile-adapter :deep(.pricing-table td .cell) {
  flex: 1 1 auto;
  width: auto !important;
  min-width: 0;
}

.mobile-adapter :deep(.pricing-table td[data-label='Model'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='模型'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='Available Channels'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='可用渠道'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='Supported Formats'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='支持格式'] .cell) {
  text-align: right;
}

.mobile-adapter :deep(.pricing-table td[data-label='Pricing Type'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='计费类型'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='Fixed Price'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='固定价格'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='Input Price'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='输入价格'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='Output Price'] .cell),
.mobile-adapter :deep(.pricing-table td[data-label='输出价格'] .cell) {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  text-align: right;
}

.mobile-adapter :deep(.el-table__body td[data-label='']::before) {
  display: none;
}

.mobile-adapter :deep(.el-table__fixed-right) {
  position: static !important;
  box-shadow: none !important;
  border-left: none !important;
}

.mobile-adapter :deep(.el-table .el-button),
.mobile-adapter :deep(.el-dialog .el-button),
.mobile-adapter :deep(.el-card .el-button) {
  min-height: 36px;
}

.mobile-adapter :deep(.el-table .el-button + .el-button),
.mobile-adapter :deep(.el-dialog__footer .el-button + .el-button),
.mobile-adapter :deep(.el-card .el-button + .el-button) {
  margin-left: 8px !important;
}

.mobile-adapter :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 4vh !important;
}

.mobile-adapter .monthly-pass-doc-toolbar {
  flex-direction: column;
}

.mobile-adapter .monthly-pass-doc-toolbar :deep(.el-button) {
  width: 100%;
}

.mobile-adapter :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding: 14px 12px;
}

.mobile-adapter :deep(.el-pagination) {
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
