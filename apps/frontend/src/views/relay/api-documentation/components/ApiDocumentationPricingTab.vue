<script setup lang="ts">
import { ArrowDown, ArrowUp, Refresh, Search } from '@element-plus/icons-vue'
import ComponentErrorBoundary from '@/components/common/ComponentErrorBoundary.vue'
import ModelPricingTable from '@/components/relay/ModelPricingTable.vue'
import { i18ns } from '@/locales'
import { useApiDocumentationContext } from '../context'

const state = useApiDocumentationContext()
const channels = state.channels
const filterFormat = state.filterFormat
const filterChannelIds = state.filterChannelIds
const filterPricingType = state.filterPricingType
const filterModelKeyword = state.filterModelKeyword
const onlyModelsWithChannels = state.onlyModelsWithChannels
const channelMatchMode = state.channelMatchMode
const channelPriceMode = state.channelPriceMode
const pricingTableMode = state.pricingTableMode
const primaryComparisonChannelId = state.primaryComparisonChannelId
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
const selectedChannelCount = state.selectedChannelCount
const selectedChannelSummary = state.selectedChannelSummary
const selectedChannels = state.selectedChannels
const primaryComparisonChannel = state.primaryComparisonChannel
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
const getChannelPriceCell = state.getChannelPriceCell
const handlePriceRangeChange = state.handlePriceRangeChange
const resetPriceRangeFilter = state.resetPriceRangeFilter
const handlePricingTypeFilterChange = state.handlePricingTypeFilterChange
const handleChannelMatchModeChange = state.handleChannelMatchModeChange
const handleChannelPriceModeChange = state.handleChannelPriceModeChange
const handlePricingTableModeChange = state.handlePricingTableModeChange
const handlePrimaryComparisonChannelChange = state.handlePrimaryComparisonChannelChange
const handleSortChange = state.handleSortChange
const t = i18ns.t

const comparisonSortField = mobileSortField
const comparisonSortOrder = mobileSortOrder

const channelMatchModeOptions = [
  { label: t('apiDoc.channelMatchModeAny'), value: 'match-any' },
  { label: t('apiDoc.channelMatchModeAll'), value: 'match-all' },
] as const

const channelPriceModeOptions = [
  { label: t('apiDoc.channelPriceModeBase'), value: 'base' },
  { label: t('apiDoc.channelPriceModeSelectedLowest'), value: 'selected-lowest' },
  { label: t('apiDoc.channelPriceModeGlobalLowest'), value: 'global-lowest' },
] as const

const pricingTableModeOptions = [
  { label: t('apiDoc.pricingTableModeSummary'), value: 'summary' },
  { label: t('apiDoc.pricingTableModeChannelColumns'), value: 'channel-columns' },
] as const

const toggleMobilePricingControlsExpanded = () => {
  mobilePricingControlsExpanded.value = !mobilePricingControlsExpanded.value
}

const toggleMobilePricingAdvancedSettingsExpanded = () => {
  mobilePricingAdvancedSettingsExpanded.value = !mobilePricingAdvancedSettingsExpanded.value
}

const onChannelMatchModeChange = (value: string | number | boolean | undefined) => {
  handleChannelMatchModeChange((value || 'match-any') as 'match-any' | 'match-all')
}

const onChannelPriceModeChange = (value: string | number | boolean | undefined) => {
  handleChannelPriceModeChange(
    (value || 'base') as 'base' | 'selected-lowest' | 'global-lowest',
  )
}

const onPricingTableModeChange = (value: string | number | boolean | undefined) => {
  handlePricingTableModeChange((value || 'summary') as 'summary' | 'channel-columns')
}

const onPrimaryComparisonChannelChange = (value: string | number | boolean | undefined) => {
  handlePrimaryComparisonChannelChange(String(value || ''))
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
          v-model="filterChannelIds"
          :placeholder="t('apiDoc.filterByChannel')"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          :max-collapse-tags="2"
          class="pricing-filter"
        >
          <el-option
            v-for="channel in channels"
            :key="channel.id"
            :label="channel.name"
            :value="channel.id"
          />
        </el-select>

        <el-tag v-if="selectedChannelCount > 0" type="info" size="small" effect="plain">
          {{ selectedChannelSummary }}
        </el-tag>

        <el-input
          v-model="filterModelKeyword"
          :placeholder="t('apiDoc.filterByModelKeyword')"
          :prefix-icon="Search"
          clearable
          class="pricing-filter"
        />

        <el-popover
          placement="bottom-start"
          trigger="click"
          :width="440"
          popper-class="pricing-more-settings-popover"
        >
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

            <div class="pricing-more-settings-item">
              <span class="pricing-inline-label">{{ t('apiDoc.pricingTableMode') }}</span>
              <el-segmented
                :model-value="pricingTableMode"
                :options="pricingTableModeOptions"
                class="pricing-mode-segmented"
                @change="onPricingTableModeChange"
              />
            </div>

            <div
              v-if="pricingTableMode === 'channel-columns'"
              class="pricing-more-settings-item pricing-more-settings-item--comparison"
            >
              <div class="pricing-setting-heading">
                <span class="pricing-inline-label">{{ t('apiDoc.primaryComparisonChannel') }}</span>
                <el-text v-if="primaryComparisonChannel" size="small" type="info">
                  {{ t('apiDoc.primaryComparisonChannelHint') }}
                </el-text>
              </div>
              <el-select
                :model-value="primaryComparisonChannelId"
                :placeholder="t('apiDoc.primaryComparisonChannelPlaceholder')"
                :disabled="selectedChannels.length === 0"
                class="pricing-filter"
                @update:model-value="onPrimaryComparisonChannelChange"
              >
                <el-option
                  v-for="channel in selectedChannels"
                  :key="channel.id"
                  :label="channel.name"
                  :value="channel.id"
                />
              </el-select>

              <div class="pricing-comparison-settings-grid">
                <div class="pricing-more-settings-item">
                  <span class="pricing-inline-label">{{ t('apiDoc.sortField') }}</span>
                  <el-select
                    v-model="comparisonSortField"
                    :placeholder="t('apiDoc.sortField')"
                    class="pricing-filter"
                  >
                    <el-option :label="t('apiDoc.noSorting')" value="" />
                    <el-option :label="t('apiDoc.model')" value="model" />
                    <el-option :label="t('apiDoc.fixedPrice')" value="fixedPrice" />
                    <el-option :label="t('apiDoc.inputPrice')" value="inputPrice" />
                    <el-option :label="t('apiDoc.outputPrice')" value="outputPrice" />
                  </el-select>
                </div>

                <div class="pricing-more-settings-item">
                  <span class="pricing-inline-label">{{ t('apiDoc.sortOrder') }}</span>
                  <el-select
                    v-model="comparisonSortOrder"
                    :placeholder="t('apiDoc.sortOrder')"
                    :disabled="!comparisonSortField"
                    class="pricing-filter"
                  >
                    <el-option :label="t('apiDoc.sortAscending')" value="asc" />
                    <el-option :label="t('apiDoc.sortDescending')" value="desc" />
                  </el-select>
                </div>
              </div>

              <div class="pricing-comparison-ranges">
                <div class="price-range-group price-range-group--popover">
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

                <div class="price-range-group price-range-group--popover">
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

                <div class="price-range-group price-range-group--popover">
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
              </div>
            </div>

            <div class="pricing-more-settings-item">
              <span class="pricing-inline-label">{{ t('apiDoc.channelMatchMode') }}</span>
              <el-segmented
                :model-value="channelMatchMode"
                :options="channelMatchModeOptions"
                class="pricing-mode-segmented"
                @change="onChannelMatchModeChange"
              />
            </div>

            <div class="pricing-more-settings-item">
              <span class="pricing-inline-label">{{ t('apiDoc.channelPriceMode') }}</span>
              <el-segmented
                :model-value="channelPriceMode"
                :options="channelPriceModeOptions"
                class="pricing-mode-segmented"
                @change="onChannelPriceModeChange"
              />
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
              v-model="filterChannelIds"
              :placeholder="t('apiDoc.filterByChannel')"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              :max-collapse-tags="2"
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

            <el-tag v-if="selectedChannelCount > 0" type="info" size="small" effect="plain">
              {{ selectedChannelSummary }}
            </el-tag>

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

                <div class="pricing-inline-control pricing-inline-control--mobile">
                  <span class="pricing-inline-label">{{ t('apiDoc.pricingTableMode') }}</span>
                  <el-segmented
                    :model-value="pricingTableMode"
                    :options="pricingTableModeOptions"
                    block
                    class="pricing-mode-segmented"
                    @change="onPricingTableModeChange"
                  />
                </div>

                <div
                  v-if="pricingTableMode === 'channel-columns'"
                  class="pricing-inline-control pricing-inline-control--mobile"
                >
                  <span class="pricing-inline-label">
                    {{ t('apiDoc.primaryComparisonChannel') }}
                  </span>
                  <el-select
                    :model-value="primaryComparisonChannelId"
                    :placeholder="t('apiDoc.primaryComparisonChannelPlaceholder')"
                    :disabled="selectedChannels.length === 0"
                    class="pricing-filter"
                    @update:model-value="onPrimaryComparisonChannelChange"
                  >
                    <el-option
                      v-for="channel in selectedChannels"
                      :key="channel.id"
                      :label="channel.name"
                      :value="channel.id"
                    />
                  </el-select>
                </div>

                <div class="pricing-inline-control pricing-inline-control--mobile">
                  <span class="pricing-inline-label">{{ t('apiDoc.channelMatchMode') }}</span>
                  <el-segmented
                    :model-value="channelMatchMode"
                    :options="channelMatchModeOptions"
                    block
                    class="pricing-mode-segmented"
                    @change="onChannelMatchModeChange"
                  />
                </div>

                <div class="pricing-inline-control pricing-inline-control--mobile">
                  <span class="pricing-inline-label">{{ t('apiDoc.channelPriceMode') }}</span>
                  <el-segmented
                    :model-value="channelPriceMode"
                    :options="channelPriceModeOptions"
                    block
                    class="pricing-mode-segmented"
                    @change="onChannelPriceModeChange"
                  />
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
        :get-channel-price-cell="getChannelPriceCell"
        :custom-price-multiplier="customPriceMultiplier"
        :custom-multiplier-active="customMultiplierActive"
        :show-cache-multipliers="showCacheMultipliers"
        :token-price-unit="tokenPriceUnit"
        :price-ranges="priceRanges"
        :on-copy-model-id="state.copyText"
        :display-mode="priceDisplayMode"
        :selected-channels="selectedChannels"
        :pricing-table-mode="pricingTableMode"
        :primary-comparison-channel-id="primaryComparisonChannelId"
        :is-desktop="isDesktop"
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
