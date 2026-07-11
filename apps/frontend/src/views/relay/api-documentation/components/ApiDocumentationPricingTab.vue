<script setup lang="ts">
import { ArrowDown, ArrowUp, Refresh, Search } from '@element-plus/icons-vue'
import ComponentErrorBoundary from '@/components/common/ComponentErrorBoundary.vue'
import ModelPricingTable from '@/components/relay/ModelPricingTable.vue'
import { i18ns } from '@/locales'
import { useApiDocumentationContext } from '../context'

const state = useApiDocumentationContext()
const channels = state.channels
const filterFormat = state.filterFormat
const filterChannel = state.filterChannel
const filterPricingType = state.filterPricingType
const filterModelKeyword = state.filterModelKeyword
const onlyModelsWithChannels = state.onlyModelsWithChannels
const showCalculatedPrice = state.showCalculatedPrice
const showLowestChannelPrice = state.showLowestChannelPrice
const customPriceMultiplier = state.customPriceMultiplier
const tokenPriceUnit = state.tokenPriceUnit
const fixedPriceMin = state.fixedPriceMin
const fixedPriceMax = state.fixedPriceMax
const inputPriceMin = state.inputPriceMin
const inputPriceMax = state.inputPriceMax
const outputPriceMin = state.outputPriceMin
const outputPriceMax = state.outputPriceMax
const sortField = state.sortField
const sortOrder = state.sortOrder
const filteredPricingData = state.filteredPricingData
const priceDisplayMode = state.priceDisplayMode
const currentPage = state.currentPage
const pageSize = state.pageSize
const pageSizeOptions = state.pageSizeOptions
const loading = state.loading
const loadErrorMessage = state.loadErrorMessage
const mobilePricingControlsExpanded = state.mobilePricingControlsExpanded
const mobilePricingAdvancedSettingsExpanded = state.mobilePricingAdvancedSettingsExpanded
const mobileSortField = state.mobileSortField
const mobileSortOrder = state.mobileSortOrder
const paginatedPricingData = state.paginatedPricingData
const selectedChannel = state.selectedChannel
const showCacheMultipliers = state.showCacheMultipliers
const customMultiplierActive = state.customMultiplierActive
const priceRanges = state.priceRanges
const isDesktop = state.isDesktop
const pricingTabActivated = state.pricingTabActivated
const refreshData = state.refreshData
const handleResetFilters = state.handleResetFilters
const toggleTokenPriceUnit = state.toggleTokenPriceUnit
const normalizeFormats = state.normalizeFormats
const getRequestModelId = state.getRequestModelId
const getHighlightParts = state.getHighlightParts
const getChannelsForModel = state.getChannelsForModel
const getDisplayedPriceMultiplier = state.getDisplayedPriceMultiplier
const handlePriceRangeChange = state.handlePriceRangeChange
const resetPriceRangeFilter = state.resetPriceRangeFilter
const handlePricingTypeFilterChange = state.handlePricingTypeFilterChange
const handleSortChange = state.handleSortChange
const t = i18ns.t as (key: string, params?: Record<string, unknown>) => string

const toggleMobilePricingControlsExpanded = () => {
  mobilePricingControlsExpanded.value = !mobilePricingControlsExpanded.value
}

const toggleMobilePricingAdvancedSettingsExpanded = () => {
  mobilePricingAdvancedSettingsExpanded.value = !mobilePricingAdvancedSettingsExpanded.value
}
</script>

<template>
  <template v-if="pricingTabActivated">
    <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
      <strong>{{ t('apiDoc.pricingNote') }}</strong>
    </el-alert>

    <div :class="['pricing-toolbar', { 'pricing-toolbar--mobile': !isDesktop }]">
      <template v-if="isDesktop">
        <el-select
          v-model="filterFormat"
          :placeholder="t('apiDoc.filterByFormat')"
          clearable
          class="pricing-filter"
        >
          <el-option label="OpenAI" value="openai" />
          <el-option label="Anthropic" value="anthropic" />
          <el-option label="Gemini" value="gemini" />
        </el-select>

        <el-select
          v-model="filterChannel"
          :placeholder="t('apiDoc.filterByChannel')"
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
          <span style="font-size: 13px; color: var(--el-text-color-regular)">
            {{ t('apiDoc.showCalculatedPrice') }}
          </span>
        </div>

        <el-input
          v-model="filterModelKeyword"
          :placeholder="t('apiDoc.filterByModelKeyword')"
          :prefix-icon="Search"
          clearable
          class="pricing-filter"
        />

        <el-popover placement="bottom-start" trigger="click" :width="320">
          <template #reference>
            <el-button>
              {{ t('apiDoc.moreSettings') }}
            </el-button>
          </template>

          <div class="pricing-more-settings-panel" @click.stop>
            <div class="pricing-more-settings-item">
              <span class="pricing-inline-label">{{ t('apiDoc.customPriceMultiplier') }}</span>
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
              <span class="pricing-inline-label">{{ t('apiDoc.tokenPriceUnit') }}</span>
              <el-button class="pricing-unit-toggle" @click="toggleTokenPriceUnit">
                {{ tokenPriceUnit }}
              </el-button>
            </div>

            <div class="pricing-more-settings-item pricing-more-settings-item--between">
              <span class="pricing-inline-label">{{ t('apiDoc.showCacheMultipliers') }}</span>
              <el-switch v-model="showCacheMultipliers" />
            </div>

            <div class="pricing-more-settings-item pricing-more-settings-item--between">
              <span class="pricing-inline-label">{{ t('apiDoc.showLowestChannelPrice') }}</span>
              <el-switch v-model="showLowestChannelPrice" />
            </div>

            <el-checkbox v-model="onlyModelsWithChannels" class="pricing-checkbox">
              {{ t('apiDoc.onlyModelsWithChannels') }}
            </el-checkbox>
          </div>
        </el-popover>

        <template v-if="customMultiplierActive">
          <el-tag type="warning" size="small" effect="dark" class="custom-multiplier-badge">
            {{ t('apiDoc.customMultiplierApplied') }}
          </el-tag>
        </template>

        <el-button @click="handleResetFilters">{{ t('reset') }}</el-button>

        <el-button :icon="Refresh" @click="refreshData" :loading="loading" type="primary">
          {{ t('refresh') }}
        </el-button>

        <el-text type="info" size="small" class="toolbar-count">
          {{ t('apiDoc.showingModels', { count: filteredPricingData.length }) }}
        </el-text>
      </template>

      <template v-else>
        <div class="pricing-mobile-toolbar-header">
          <el-text type="info" size="small" class="toolbar-count">
            {{ t('apiDoc.showingModels', { count: filteredPricingData.length }) }}
          </el-text>

          <div class="pricing-mobile-toolbar-actions">
            <el-button :icon="Refresh" @click="refreshData" :loading="loading" type="primary">
              {{ t('refresh') }}
            </el-button>
            <el-button
              :icon="mobilePricingControlsExpanded ? ArrowUp : ArrowDown"
              @click="toggleMobilePricingControlsExpanded"
            >
              {{
                mobilePricingControlsExpanded
                  ? t('apiDoc.collapseFiltersAndSort')
                  : t('apiDoc.expandFiltersAndSort')
              }}
            </el-button>
          </div>
        </div>

        <el-collapse-transition>
          <div v-show="mobilePricingControlsExpanded" class="pricing-mobile-panel">
            <el-input
              v-model="filterModelKeyword"
              :placeholder="t('apiDoc.filterByModelKeyword')"
              :prefix-icon="Search"
              clearable
              class="pricing-filter"
            />

            <el-select
              v-model="filterFormat"
              :placeholder="t('apiDoc.filterByFormat')"
              clearable
              class="pricing-filter"
            >
              <el-option label="OpenAI" value="openai" />
              <el-option label="Anthropic" value="anthropic" />
              <el-option label="Gemini" value="gemini" />
            </el-select>

            <el-select
              v-model="filterChannel"
              :placeholder="t('apiDoc.filterByChannel')"
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
              :placeholder="t('apiDoc.filterByPricingType')"
              clearable
              class="pricing-filter"
            >
              <el-option :label="t('apiDoc.tokenBased')" value="token-based" />
              <el-option :label="t('apiDoc.perRequest')" value="per-request" />
            </el-select>

            <el-select
              v-model="mobileSortField"
              :placeholder="t('apiDoc.sortField')"
              class="pricing-filter"
            >
              <el-option :label="t('apiDoc.noSorting')" value="" />
              <el-option :label="t('apiDoc.model')" value="model" />
              <el-option :label="t('apiDoc.fixedPrice')" value="fixedPrice" />
              <el-option :label="t('apiDoc.inputPrice')" value="inputPrice" />
              <el-option :label="t('apiDoc.outputPrice')" value="outputPrice" />
            </el-select>

            <el-select
              v-model="mobileSortOrder"
              :placeholder="t('apiDoc.sortOrder')"
              :disabled="!mobileSortField"
              class="pricing-filter"
            >
              <el-option :label="t('apiDoc.sortAscending')" value="asc" />
              <el-option :label="t('apiDoc.sortDescending')" value="desc" />
            </el-select>

            <div v-if="filterChannel" class="pricing-mobile-switch">
              <span class="pricing-mobile-switch-label">
                {{ t('apiDoc.showCalculatedPrice') }}
              </span>
              <el-switch v-model="showCalculatedPrice" :disabled="!filterChannel" />
            </div>

            <el-button
              text
              class="pricing-more-settings-toggle"
              @click="toggleMobilePricingAdvancedSettingsExpanded"
            >
              {{
                mobilePricingAdvancedSettingsExpanded
                  ? t('apiDoc.hideMoreSettings')
                  : t('apiDoc.moreSettings')
              }}
            </el-button>

            <el-collapse-transition>
              <div
                v-show="mobilePricingAdvancedSettingsExpanded"
                class="pricing-mobile-advanced-panel"
              >
                <div class="pricing-inline-control pricing-inline-control--mobile">
                  <span class="pricing-inline-label">{{ t('apiDoc.customPriceMultiplier') }}</span>
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
                    {{ t('apiDoc.showCacheMultipliers') }}
                  </span>
                  <el-switch v-model="showCacheMultipliers" />
                </div>

                <div class="pricing-inline-control pricing-inline-control--mobile">
                  <span class="pricing-inline-label">{{ t('apiDoc.tokenPriceUnit') }}</span>
                  <el-button
                    class="pricing-unit-toggle pricing-unit-toggle--mobile"
                    @click="toggleTokenPriceUnit"
                  >
                    {{ tokenPriceUnit }}
                  </el-button>
                </div>

                <div class="pricing-mobile-switch">
                  <span class="pricing-mobile-switch-label">
                    {{ t('apiDoc.showLowestChannelPrice') }}
                  </span>
                  <el-switch v-model="showLowestChannelPrice" />
                </div>

                <el-checkbox v-model="onlyModelsWithChannels" class="pricing-checkbox">
                  {{ t('apiDoc.onlyModelsWithChannels') }}
                </el-checkbox>
              </div>
            </el-collapse-transition>

            <div class="price-range-group">
              <span class="price-range-label">{{ t('apiDoc.fixedPrice') }}</span>
              <el-input-number
                v-model="fixedPriceMin"
                :placeholder="t('apiDoc.minPrice')"
                :min="0"
                :step="0.01"
                :precision="4"
                class="price-range-input"
                controls-position="right"
              />
              <span class="price-range-separator">~</span>
              <el-input-number
                v-model="fixedPriceMax"
                :placeholder="t('apiDoc.maxPrice')"
                :min="0"
                :step="0.01"
                :precision="4"
                class="price-range-input"
                controls-position="right"
              />
            </div>

            <div class="price-range-group">
              <span class="price-range-label">{{ t('apiDoc.inputPrice') }}</span>
              <el-input-number
                v-model="inputPriceMin"
                :placeholder="t('apiDoc.minPrice')"
                :min="0"
                :step="0.01"
                :precision="4"
                class="price-range-input"
                controls-position="right"
              />
              <span class="price-range-separator">~</span>
              <el-input-number
                v-model="inputPriceMax"
                :placeholder="t('apiDoc.maxPrice')"
                :min="0"
                :step="0.01"
                :precision="4"
                class="price-range-input"
                controls-position="right"
              />
            </div>

            <div class="price-range-group">
              <span class="price-range-label">{{ t('apiDoc.outputPrice') }}</span>
              <el-input-number
                v-model="outputPriceMin"
                :placeholder="t('apiDoc.minPrice')"
                :min="0"
                :step="0.01"
                :precision="4"
                class="price-range-input"
                controls-position="right"
              />
              <span class="price-range-separator">~</span>
              <el-input-number
                v-model="outputPriceMax"
                :placeholder="t('apiDoc.maxPrice')"
                :min="0"
                :step="0.01"
                :precision="4"
                class="price-range-input"
                controls-position="right"
              />
            </div>

            <template v-if="customMultiplierActive">
              <el-tag type="warning" size="small" effect="dark" style="justify-self: start">
                {{ t('apiDoc.customMultiplierApplied') }}
              </el-tag>
            </template>

            <el-button @click="handleResetFilters">{{ t('reset') }}</el-button>
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
        :on-copy-model-id="state.copyText"
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
</template>
