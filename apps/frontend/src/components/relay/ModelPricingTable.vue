<template>
  <div class="pricing-table-wrapper">
    <el-alert
      v-if="errorMessage"
      type="error"
      show-icon
      :closable="false"
      :title="errorMessage"
      style="margin-bottom: 12px"
    />

    <div
      v-else-if="props.pricingTableMode === 'channel-columns' && comparisonChannels.length === 0"
      class="pricing-table-empty-state"
    >
      <el-empty :description="t('apiDoc.comparisonModeEmpty')" />
    </div>

    <div v-else-if="props.pricingTableMode === 'channel-columns' && props.isDesktop === false">
      <div v-if="rows.length === 0" class="pricing-table-empty-state">
        <el-empty description="No pricing data available" />
      </div>

      <div v-else class="comparison-card-list">
        <article v-for="row in rows" :key="getModelId(row)" class="comparison-card">
          <div class="comparison-card__header">
            <div class="model-cell">
              <div class="model-id-section">
                <el-link type="primary" tag="b" @click="copyModelId(row)" class="model-id-link">
                  <span>
                    <template
                      v-for="(part, index) in getHighlightParts(getModelId(row))"
                      :key="`mobile-modelId-${row.model}-${index}`"
                    >
                      <mark v-if="part.matched" class="highlight-match">{{ part.text }}</mark>
                      <span v-else>{{ part.text }}</span>
                    </template>
                  </span>
                </el-link>
              </div>
              <div v-if="row.model" class="model-name-section">
                <el-text size="small" type="info">
                  <template
                    v-for="(part, index) in getHighlightParts(row.model)"
                    :key="`mobile-model-${row.model}-${index}`"
                  >
                    <mark v-if="part.matched" class="highlight-match">{{ part.text }}</mark>
                    <span v-else>{{ part.text }}</span>
                  </template>
                </el-text>
              </div>
            </div>
          </div>

          <div class="comparison-card__channels">
            <section
              v-for="channel in comparisonChannels"
              :key="`${getModelId(row)}-${channel.id}`"
              class="comparison-channel-card"
            >
              <div class="comparison-channel-card__title-row">
                <span class="comparison-channel-card__title">{{ channel.name }}</span>
                <el-tag
                  v-if="channel.id === props.primaryComparisonChannelId"
                  size="small"
                  type="success"
                  effect="plain"
                >
                  {{ t('apiDoc.primaryComparisonChannelTag') }}
                </el-tag>
              </div>

              <template v-if="getChannelPriceCellValue(row, channel).available">
                <div v-if="row.pricingType === 'per-request'" class="comparison-price-row">
                  <span class="comparison-price-label">{{ t('apiDoc.fixedPrice') }}</span>
                  <el-text type="danger" tag="b">
                    {{
                      formatComparableFixedPriceRange(
                        getChannelPriceCellValue(row, channel).fixedPrice,
                        getChannelPriceCellValue(row, channel).maximumFixedPrice,
                      )
                    }}
                  </el-text>
                </div>
                <template v-else>
                  <div class="comparison-price-row">
                    <span class="comparison-price-label">{{ t('apiDoc.inputPrice') }}</span>
                    <el-text type="success" tag="b">
                      {{
                        formatComparableTokenPriceRange(
                          getChannelPriceCellValue(row, channel).inputPrice,
                          getChannelPriceCellValue(row, channel).maximumInputPrice,
                        )
                      }}
                    </el-text>
                  </div>
                  <div class="comparison-price-row">
                    <span class="comparison-price-label">{{ t('apiDoc.outputPrice') }}</span>
                    <el-text type="warning" tag="b">
                      {{
                        formatComparableTokenPriceRange(
                          getChannelPriceCellValue(row, channel).outputPrice,
                          getChannelPriceCellValue(row, channel).maximumOutputPrice,
                        )
                      }}
                    </el-text>
                  </div>
                </template>
              </template>
              <el-text v-else size="small" type="info">
                {{ t('apiDoc.channelUnavailableForModel') }}
              </el-text>
            </section>
          </div>
        </article>
      </div>
    </div>

    <el-table v-else :data="rows" border stripe v-loading="loading" class="pricing-table">
      <template #empty>
        <el-empty description="No pricing data available" />
      </template>

      <el-table-column prop="model" :label="t('apiDoc.model')" min-width="200">
        <template #header>
          <div class="column-header">
            <span>{{ t('apiDoc.model') }}</span>
            <div class="column-header-actions">
              <el-button
                circle
                size="small"
                text
                :type="getSortButtonType('model')"
                class="column-header-button"
                @click.stop="toggleSort('model')"
              >
                <el-icon><component :is="getSortIcon('model')" /></el-icon>
              </el-button>
            </div>
          </div>
        </template>
        <template #default="{ row }">
          <div class="model-cell">
            <div class="model-id-section">
              <el-link type="primary" tag="b" @click="copyModelId(row)" class="model-id-link">
                <span>
                  <template
                    v-for="(part, index) in getHighlightParts(getModelId(row))"
                    :key="`modelId-${row.model}-${index}`"
                  >
                    <mark v-if="part.matched" class="highlight-match">{{ part.text }}</mark>
                    <span v-else>{{ part.text }}</span>
                  </template>
                </span>
              </el-link>
            </div>
            <div v-if="row.model" class="model-name-section">
              <el-text size="small" type="info">
                <template
                  v-for="(part, index) in getHighlightParts(row.model)"
                  :key="`model-${row.model}-${index}`"
                >
                  <mark v-if="part.matched" class="highlight-match">{{ part.text }}</mark>
                  <span v-else>{{ part.text }}</span>
                </template>
              </el-text>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column
        v-if="props.pricingTableMode === 'summary'"
        :label="t('apiDoc.pricingType')"
        width="120"
        align="center"
      >
        <template #header>
          <div class="column-header">
            <span>{{ t('apiDoc.pricingType') }}</span>
            <div class="column-header-actions">
              <el-popover placement="bottom-start" trigger="click" :width="220">
                <template #reference>
                  <el-button
                    circle
                    size="small"
                    text
                    :type="props.pricingTypeFilter ? 'primary' : 'default'"
                    class="column-header-button"
                    @click.stop
                  >
                    <el-icon><Filter /></el-icon>
                  </el-button>
                </template>
                <div class="price-filter-panel" @click.stop>
                  <div class="price-filter-title">{{ t('apiDoc.pricingType') }}</div>
                  <el-select
                    :model-value="props.pricingTypeFilter"
                    :placeholder="t('apiDoc.filterByPricingType')"
                    clearable
                    :teleported="false"
                    class="price-filter-input"
                    @update:model-value="
                      (value: string | number | boolean | null | undefined) =>
                        props.onPricingTypeFilterChange?.(String(value || ''))
                    "
                  >
                    <el-option :label="t('apiDoc.tokenBased')" value="token-based" />
                    <el-option :label="t('apiDoc.perRequest')" value="per-request" />
                  </el-select>
                  <div class="price-filter-actions">
                    <el-button
                      size="small"
                      text
                      :disabled="!props.pricingTypeFilter"
                      @click="props.onPricingTypeFilterChange?.('')"
                    >
                      {{ t('reset') }}
                    </el-button>
                  </div>
                </div>
              </el-popover>
            </div>
            <el-text
              v-if="props.pricingTypeFilter"
              type="primary"
              size="small"
              class="column-header-filter-summary"
              >{{ getPricingTypeSummary() }}</el-text
            >
          </div>
        </template>
        <template #default="{ row }">
          <el-tag
            v-if="row.pricingType === 'per-request'"
            type="warning"
            size="small"
            effect="dark"
          >
            {{ t('apiDoc.perRequest') }}
          </el-tag>
          <el-tag v-else type="success" size="small" effect="dark">
            {{ t('apiDoc.tokenBased') }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column
        v-if="props.pricingTableMode === 'summary'"
        :label="t('apiDoc.fixedPrice')"
        width="140"
        align="right"
        prop="fixedPrice"
      >
        <template #header>
          <div class="column-header column-header--right">
            <span>{{ t('apiDoc.fixedPrice') }}</span>
            <div class="column-header-actions column-header-actions--right">
              <el-button
                circle
                size="small"
                text
                :type="getSortButtonType('fixedPrice')"
                class="column-header-button"
                @click.stop="toggleSort('fixedPrice')"
              >
                <el-icon><component :is="getSortIcon('fixedPrice')" /></el-icon>
              </el-button>
              <el-popover placement="bottom-end" trigger="click" :width="260">
                <template #reference>
                  <el-button
                    circle
                    size="small"
                    text
                    :type="hasActiveRange('fixedPrice') ? 'primary' : 'default'"
                    class="column-header-button"
                    @click.stop
                  >
                    <el-icon><Filter /></el-icon>
                  </el-button>
                </template>
                <div class="price-filter-panel" @click.stop>
                  <div class="price-filter-title">{{ t('apiDoc.fixedPrice') }}</div>
                  <el-input-number
                    :model-value="props.priceRanges.fixedPrice.min"
                    :placeholder="t('apiDoc.minPrice')"
                    :min="0"
                    :step="0.01"
                    :precision="4"
                    controls-position="right"
                    class="price-filter-input"
                    @update:model-value="
                      (value: number | string | null | undefined) =>
                        handlePriceRangeInput('fixedPrice', 'min', value)
                    "
                  />
                  <el-input-number
                    :model-value="props.priceRanges.fixedPrice.max"
                    :placeholder="t('apiDoc.maxPrice')"
                    :min="0"
                    :step="0.01"
                    :precision="4"
                    controls-position="right"
                    class="price-filter-input"
                    @update:model-value="
                      (value: number | string | null | undefined) =>
                        handlePriceRangeInput('fixedPrice', 'max', value)
                    "
                  />
                  <div class="price-filter-actions">
                    <el-button
                      size="small"
                      text
                      :disabled="!hasActiveRange('fixedPrice')"
                      @click="props.onPriceRangeReset?.('fixedPrice')"
                    >
                      {{ t('reset') }}
                    </el-button>
                  </div>
                </div>
              </el-popover>
            </div>
            <el-text
              v-if="hasActiveRange('fixedPrice')"
              type="primary"
              size="small"
              class="column-header-filter-summary"
              >{{ getRangeSummary('fixedPrice') }}</el-text
            >
          </div>
        </template>
        <template #default="{ row }">
          <el-text v-if="row.pricingType === 'per-request'" type="danger" tag="b">
            {{ formatChannelFixedPrice(row.fixedPrice, getDisplayMultiplier(row)) }}
          </el-text>
          <span v-else class="empty-cell">-</span>
        </template>
      </el-table-column>

      <el-table-column
        v-if="props.pricingTableMode === 'summary'"
        :label="t('apiDoc.inputPrice')"
        width="180"
        align="right"
        prop="inputPrice"
      >
        <template #header>
          <div class="column-header column-header--right">
            <span>{{ priceLabel('apiDoc.inputPrice') }}</span>
            <div class="column-header-actions column-header-actions--right">
              <el-button
                circle
                size="small"
                text
                :type="getSortButtonType('inputPrice')"
                class="column-header-button"
                @click.stop="toggleSort('inputPrice')"
              >
                <el-icon><component :is="getSortIcon('inputPrice')" /></el-icon>
              </el-button>
              <el-popover placement="bottom-end" trigger="click" :width="260">
                <template #reference>
                  <el-button
                    circle
                    size="small"
                    text
                    :type="hasActiveRange('inputPrice') ? 'primary' : 'default'"
                    class="column-header-button"
                    @click.stop
                  >
                    <el-icon><Filter /></el-icon>
                  </el-button>
                </template>
                <div class="price-filter-panel" @click.stop>
                  <div class="price-filter-title">{{ t('apiDoc.inputPrice') }}</div>
                  <el-input-number
                    :model-value="props.priceRanges.inputPrice.min"
                    :placeholder="t('apiDoc.minPrice')"
                    :min="0"
                    :step="0.01"
                    :precision="4"
                    controls-position="right"
                    class="price-filter-input"
                    @update:model-value="
                      (value: number | string | null | undefined) =>
                        handlePriceRangeInput('inputPrice', 'min', value)
                    "
                  />
                  <el-input-number
                    :model-value="props.priceRanges.inputPrice.max"
                    :placeholder="t('apiDoc.maxPrice')"
                    :min="0"
                    :step="0.01"
                    :precision="4"
                    controls-position="right"
                    class="price-filter-input"
                    @update:model-value="
                      (value: number | string | null | undefined) =>
                        handlePriceRangeInput('inputPrice', 'max', value)
                    "
                  />
                  <div class="price-filter-actions">
                    <el-button
                      size="small"
                      text
                      :disabled="!hasActiveRange('inputPrice')"
                      @click="props.onPriceRangeReset?.('inputPrice')"
                    >
                      {{ t('reset') }}
                    </el-button>
                  </div>
                </div>
              </el-popover>
            </div>
            <el-text
              v-if="hasActiveRange('inputPrice')"
              type="primary"
              size="small"
              class="column-header-filter-summary"
              >{{ getRangeSummary('inputPrice') }}</el-text
            >
          </div>
        </template>
        <template #default="{ row }">
          <div
            v-if="row.pricingType !== 'per-request'"
            class="token-price-cell token-price-cell--input"
          >
            <el-text type="success" tag="b">
              {{ formatChannelTokenPrice(row.inputPrice, getDisplayMultiplier(row)) }}
            </el-text>
            <el-text
              v-if="props.showCacheMultipliers"
              size="small"
              type="warning"
              class="cache-multiplier-text"
              >{{
                formatCacheMultiplier(row.cacheCreationMultiplier, row.cacheReadMultiplier)
              }}</el-text
            >
          </div>
          <span v-else class="empty-cell">-</span>
        </template>
      </el-table-column>

      <el-table-column
        v-if="props.pricingTableMode === 'summary'"
        :label="t('apiDoc.outputPrice')"
        width="180"
        align="right"
        prop="outputPrice"
      >
        <template #header>
          <div class="column-header column-header--right">
            <span>{{ priceLabel('apiDoc.outputPrice') }}</span>
            <div class="column-header-actions column-header-actions--right">
              <el-button
                circle
                size="small"
                text
                :type="getSortButtonType('outputPrice')"
                class="column-header-button"
                @click.stop="toggleSort('outputPrice')"
              >
                <el-icon><component :is="getSortIcon('outputPrice')" /></el-icon>
              </el-button>
              <el-popover placement="bottom-end" trigger="click" :width="260">
                <template #reference>
                  <el-button
                    circle
                    size="small"
                    text
                    :type="hasActiveRange('outputPrice') ? 'primary' : 'default'"
                    class="column-header-button"
                    @click.stop
                  >
                    <el-icon><Filter /></el-icon>
                  </el-button>
                </template>
                <div class="price-filter-panel" @click.stop>
                  <div class="price-filter-title">{{ t('apiDoc.outputPrice') }}</div>
                  <el-input-number
                    :model-value="props.priceRanges.outputPrice.min"
                    :placeholder="t('apiDoc.minPrice')"
                    :min="0"
                    :step="0.01"
                    :precision="4"
                    controls-position="right"
                    class="price-filter-input"
                    @update:model-value="
                      (value: number | string | null | undefined) =>
                        handlePriceRangeInput('outputPrice', 'min', value)
                    "
                  />
                  <el-input-number
                    :model-value="props.priceRanges.outputPrice.max"
                    :placeholder="t('apiDoc.maxPrice')"
                    :min="0"
                    :step="0.01"
                    :precision="4"
                    controls-position="right"
                    class="price-filter-input"
                    @update:model-value="
                      (value: number | string | null | undefined) =>
                        handlePriceRangeInput('outputPrice', 'max', value)
                    "
                  />
                  <div class="price-filter-actions">
                    <el-button
                      size="small"
                      text
                      :disabled="!hasActiveRange('outputPrice')"
                      @click="props.onPriceRangeReset?.('outputPrice')"
                    >
                      {{ t('reset') }}
                    </el-button>
                  </div>
                </div>
              </el-popover>
            </div>
            <el-text
              v-if="hasActiveRange('outputPrice')"
              type="primary"
              size="small"
              class="column-header-filter-summary"
              >{{ getRangeSummary('outputPrice') }}</el-text
            >
          </div>
        </template>
        <template #default="{ row }">
          <div
            v-if="row.pricingType !== 'per-request'"
            class="token-price-cell token-price-cell--output"
          >
            <el-text type="warning" tag="b">
              {{ formatChannelTokenPrice(row.outputPrice, getDisplayMultiplier(row)) }}
            </el-text>
            <el-text
              v-if="props.showCacheMultipliers"
              size="small"
              type="warning"
              class="cache-multiplier-text"
              >{{
                formatCacheMultiplier(row.cacheCreationMultiplier, row.cacheReadMultiplier)
              }}</el-text
            >
          </div>
          <span v-else class="empty-cell">-</span>
        </template>
      </el-table-column>

      <el-table-column
        v-if="props.pricingTableMode === 'summary'"
        :label="t('apiDoc.supportedFormats')"
        width="140"
        align="center"
      >
        <template #default="{ row }">
          <el-tag
            v-if="normalizeFormats(row.supportedFormats).includes('openai')"
            size="small"
            type="success"
          >
            OpenAI
          </el-tag>
          <el-tag
            v-if="normalizeFormats(row.supportedFormats).includes('anthropic')"
            size="small"
            type="warning"
          >
            Anthropic
          </el-tag>
          <el-tag
            v-if="normalizeFormats(row.supportedFormats).includes('gemini')"
            size="small"
            type="primary"
          >
            Gemini
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column
        v-if="props.pricingTableMode === 'summary'"
        :label="t('apiDoc.availableChannels')"
        min-width="220"
      >
        <template #default="{ row }">
          <div class="channels-cell">
            <el-tooltip
              v-for="channel in getAvailableChannels(row)"
              :key="channel.id"
              placement="top"
              effect="light"
              :show-after="300"
            >
              <template #content>
                <div class="channel-price-tooltip">
                  <div class="channel-price-header">
                    {{ channel.name }}
                    <el-tag size="small" type="info" effect="plain">
                      <template v-if="isPooledChannel(channel)">
                        {{ getPoolLabel(channel) }}
                      </template>
                      <template v-else>×{{ getTooltipMultiplierLabel(row, channel) }}</template>
                    </el-tag>
                  </div>
                  <template v-if="isPooledChannel(channel)">
                    <div class="channel-price-hint">
                      {{ t('apiDoc.automaticPoolVariablePriceHint') }}
                    </div>
                    <div v-if="isAutomaticProxyPool(channel)" class="channel-price-row">
                      <span class="channel-price-label">{{ t('apiDoc.routingStrategy') }}:</span>
                      <el-text size="small">{{ getRoutingStrategyLabel(channel) }}</el-text>
                    </div>
                    <div
                      v-for="member in getPoolPricingMembers(channel)"
                      :key="member.id"
                      class="automatic-pool-member"
                    >
                      <div class="automatic-pool-member__header">
                        <span>{{ member.name }}</span>
                        <el-tag
                          size="small"
                          :type="member.enabled ? 'success' : 'info'"
                          effect="plain"
                        >
                          {{
                            member.enabled
                              ? t('apiDoc.poolMemberActive')
                              : t('apiDoc.poolMemberInactive')
                          }}
                        </el-tag>
                      </div>
                      <div class="automatic-pool-member__meta">
                        {{ t('apiDoc.baseMultiplier') }} ×{{
                          formatMultiplier(member.multiplier)
                        }}
                        · {{ t('apiDoc.timeMultiplier') }} ×{{
                          formatMultiplier(member.timePeriodMultiplier)
                        }}
                        · {{ t('apiDoc.effectiveMultiplier') }} ×{{
                          formatMultiplier(member.effectiveMultiplier)
                        }}
                      </div>
                      <template v-if="getAutomaticPoolMemberPrice(row, channel, member.id)">
                        <div
                          v-if="row.pricingType === 'per-request'"
                          class="automatic-pool-member__price"
                        >
                          {{ t('apiDoc.fixedPrice') }}:
                          {{
                            formatComparableFixedPrice(
                              getAutomaticPoolMemberPrice(row, channel, member.id)?.fixedPrice ??
                                null,
                            )
                          }}
                        </div>
                        <template v-else>
                          <div class="automatic-pool-member__price">
                            {{ t('apiDoc.inputPrice') }}:
                            {{
                              formatComparableTokenPrice(
                                getAutomaticPoolMemberPrice(row, channel, member.id)?.inputPrice ??
                                  null,
                              )
                            }}
                          </div>
                          <div class="automatic-pool-member__price">
                            {{ t('apiDoc.outputPrice') }}:
                            {{
                              formatComparableTokenPrice(
                                getAutomaticPoolMemberPrice(row, channel, member.id)?.outputPrice ??
                                  null,
                              )
                            }}
                          </div>
                        </template>
                      </template>
                      <el-text v-else size="small" type="info">{{
                        t('apiDoc.poolMemberUnavailableForModel')
                      }}</el-text>
                    </div>
                  </template>
                  <template v-else-if="row.pricingType !== 'per-request'">
                    <div class="channel-price-row">
                      <span class="channel-price-label">{{ t('apiDoc.inputPrice') }}:</span>
                      <div class="token-price-tooltip-value">
                        <el-text type="success" tag="b">
                          {{
                            formatChannelTokenPrice(
                              row.inputPrice,
                              getTooltipMultiplier(row, channel),
                            )
                          }}
                        </el-text>
                      </div>
                    </div>
                    <div class="channel-price-row">
                      <span class="channel-price-label">{{ t('apiDoc.outputPrice') }}:</span>
                      <div class="token-price-tooltip-value">
                        <el-text type="warning" tag="b">
                          {{
                            formatChannelTokenPrice(
                              row.outputPrice,
                              getTooltipMultiplier(row, channel),
                            )
                          }}
                        </el-text>
                      </div>
                    </div>
                    <div
                      v-if="props.showCacheMultipliers"
                      class="channel-price-row channel-price-row--stacked"
                    >
                      <span class="channel-price-label">{{ t('apiDoc.cacheMultipliers') }}:</span>
                      <el-text size="small" type="warning">
                        {{
                          formatCacheMultiplier(
                            row.cacheCreationMultiplier,
                            row.cacheReadMultiplier,
                          )
                        }}
                      </el-text>
                    </div>
                  </template>
                  <template v-else>
                    <div class="channel-price-row">
                      <span class="channel-price-label">{{ t('apiDoc.fixedPrice') }}:</span>
                      <el-text type="danger" tag="b">
                        {{
                          formatChannelFixedPrice(
                            row.fixedPrice,
                            getTooltipMultiplier(row, channel),
                          )
                        }}
                      </el-text>
                    </div>
                  </template>
                  <div class="channel-price-hint">{{ t('apiDoc.channelEffectivePrice') }}</div>
                </div>
              </template>
              <el-tag
                size="small"
                :type="isSelectedChannel(channel.id) ? 'success' : 'primary'"
                :effect="isSelectedChannel(channel.id) ? 'dark' : 'plain'"
                style="margin: 2px; cursor: default"
                class="channel-tag"
              >
                {{ channel.name }}
                <span v-if="isPooledChannel(channel)" class="channel-multiplier-badge">
                  {{ getPoolLabel(channel) }}
                </span>
                <span v-else-if="channel.multiplier !== 1" class="channel-multiplier-badge">
                  ×{{ formatMultiplier(channel.multiplier) }}
                </span>
              </el-tag>
            </el-tooltip>
            <el-text v-if="getAvailableChannels(row).length === 0" type="info" size="small">
              {{ t('apiDoc.noChannels') }}
            </el-text>
          </div>
        </template>
      </el-table-column>

      <template v-if="props.pricingTableMode === 'channel-columns'">
        <el-table-column v-for="channel in comparisonChannels" :key="channel.id" :min-width="220">
          <template #header>
            <div class="comparison-column-header">
              <div class="comparison-column-header__title-row">
                <span class="comparison-column-header__title">{{ channel.name }}</span>
                <el-tag
                  v-if="channel.id === props.primaryComparisonChannelId"
                  size="small"
                  type="success"
                  effect="plain"
                >
                  {{ t('apiDoc.primaryComparisonChannelTag') }}
                </el-tag>
              </div>
              <el-tag
                v-if="
                  channel.id === props.primaryComparisonChannelId && props.customMultiplierActive
                "
                size="small"
                type="warning"
                effect="plain"
              >
                {{ t('apiDoc.customMultiplierApplied') }}
              </el-tag>
            </div>
          </template>
          <template #default="{ row }">
            <div class="comparison-cell">
              <template v-if="getChannelPriceCellValue(row, channel).available">
                <div class="comparison-multiplier-row">
                  <el-tag size="small" type="info" effect="plain">
                    <template v-if="getChannelPriceCellValue(row, channel).pooledChannel">
                      {{ getPoolLabel(channel) }} ·
                      {{
                        formatMultiplierRange(
                          getChannelPriceCellValue(row, channel).multiplier,
                          getChannelPriceCellValue(row, channel).maximumMultiplier,
                        )
                      }}
                    </template>
                    <template v-else
                      >×{{
                        formatMultiplier(getChannelPriceCellValue(row, channel).multiplier)
                      }}</template
                    >
                  </el-tag>
                </div>

                <div v-if="row.pricingType === 'per-request'" class="comparison-price-block">
                  <span class="comparison-price-label">{{ t('apiDoc.fixedPrice') }}</span>
                  <el-text type="danger" tag="b">
                    {{
                      formatComparableFixedPriceRange(
                        getChannelPriceCellValue(row, channel).fixedPrice,
                        getChannelPriceCellValue(row, channel).maximumFixedPrice,
                      )
                    }}
                  </el-text>
                </div>

                <template v-else>
                  <div class="comparison-price-block">
                    <span class="comparison-price-label">{{ t('apiDoc.inputPrice') }}</span>
                    <el-text type="success" tag="b">
                      {{
                        formatComparableTokenPriceRange(
                          getChannelPriceCellValue(row, channel).inputPrice,
                          getChannelPriceCellValue(row, channel).maximumInputPrice,
                        )
                      }}
                    </el-text>
                  </div>
                  <div class="comparison-price-block">
                    <span class="comparison-price-label">{{ t('apiDoc.outputPrice') }}</span>
                    <el-text type="warning" tag="b">
                      {{
                        formatComparableTokenPriceRange(
                          getChannelPriceCellValue(row, channel).outputPrice,
                          getChannelPriceCellValue(row, channel).maximumOutputPrice,
                        )
                      }}
                    </el-text>
                  </div>
                  <el-text
                    v-if="props.showCacheMultipliers"
                    size="small"
                    type="warning"
                    class="cache-multiplier-text"
                  >
                    {{
                      formatCacheMultiplier(row.cacheCreationMultiplier, row.cacheReadMultiplier)
                    }}
                  </el-text>
                </template>
              </template>

              <el-text v-else size="small" type="info">
                {{ t('apiDoc.channelUnavailableForModel') }}
              </el-text>
            </div>
          </template>
        </el-table-column>
      </template>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import type { ModelPricingDto, RelayChannelOptionDto } from '@/client/types.gen'
import type {
  ChannelPriceCell,
  PriceRangeField,
  PricingDisplayMode,
  PricingSortField,
  PricingSortOrder,
  PricingTableMode,
} from '@/composables/useApiDocumentationPricing'
import { i18ns } from '@/locales'
import { computed } from 'vue'
import { Bottom, Filter, Sort, Top } from '@element-plus/icons-vue'

type HighlightPart = {
  text: string
  matched: boolean
}

type PricingModelRow = ModelPricingDto & {
  modelId?: string | null
}

type PriceRangeValue = {
  min: number | null
  max: number | null
}

const props = defineProps<{
  rows: PricingModelRow[]
  loading: boolean
  errorMessage?: string | null
  normalizeFormats: (formats?: string) => string[]
  getRequestModelId: (item: Pick<PricingModelRow, 'model' | 'modelId' | 'provider'>) => string
  getHighlightParts: (rawText?: string) => HighlightPart[]
  getChannelsForModel: (
    modelName: string,
    modelId: string,
    modelFormat?: string,
  ) => RelayChannelOptionDto[]
  getDisplayedPriceMultiplier: (item: PricingModelRow) => number
  getChannelPriceCell: (item: PricingModelRow, channel: RelayChannelOptionDto) => ChannelPriceCell
  customPriceMultiplier?: number | null
  customMultiplierActive?: boolean
  showCacheMultipliers?: boolean
  tokenPriceUnit?: 'M' | 'K'
  priceRanges: Record<PriceRangeField, PriceRangeValue>
  onCopyModelId: (modelId: string) => void
  displayMode?: PricingDisplayMode
  pricingTableMode?: PricingTableMode
  selectedChannels?: RelayChannelOptionDto[]
  primaryComparisonChannelId?: string
  pricingTypeFilter?: string
  sortField?: PricingSortField
  sortOrder?: PricingSortOrder
  isDesktop?: boolean
  onPriceRangeChange?: (field: PriceRangeField, bound: 'min' | 'max', value: number | null) => void
  onPriceRangeReset?: (field: PriceRangeField) => void
  onPricingTypeFilterChange?: (value: string) => void
  onSortChange?: (field: PricingSortField, order: PricingSortOrder) => void
}>()

const t = i18ns.t

const tokenUnitHint = computed(() =>
  props.tokenPriceUnit === 'K' ? t('apiDoc.pricePerKToken') : t('apiDoc.pricePerMToken'),
)

const priceLabel = (key: 'apiDoc.inputPrice' | 'apiDoc.outputPrice'): string => {
  const hint = props.customMultiplierActive ? ' ⚠' : ''
  return `${t(key)} (${tokenUnitHint.value}${hint})`
}

const selectedChannelIdSet = computed(
  () => new Set((props.selectedChannels || []).map((channel) => channel.id)),
)

const comparisonChannels = computed(() => props.selectedChannels || [])

const getModelId = (item: PricingModelRow): string => {
  return props.getRequestModelId(item)
}

const getDisplayMultiplier = (item: PricingModelRow): number =>
  props.getDisplayedPriceMultiplier(item)

const formatMultiplier = (multiplier?: number): string => {
  if (multiplier == null) return '1'
  return parseFloat(multiplier.toFixed(4)).toString()
}

const getNextSortOrder = (field: PricingSortField): PricingSortOrder => {
  if (props.sortField !== field) return 'asc'
  if (props.sortOrder === 'asc') return 'desc'
  if (props.sortOrder === 'desc') return ''
  return 'asc'
}

const toggleSort = (field: PricingSortField) => {
  props.onSortChange?.(field, getNextSortOrder(field))
}

const getSortButtonType = (field: PricingSortField): 'primary' | 'default' => {
  return props.sortField === field && props.sortOrder ? 'primary' : 'default'
}

const getSortIcon = (field: PricingSortField) => {
  if (props.sortField !== field || !props.sortOrder) return Sort
  return props.sortOrder === 'asc' ? Top : Bottom
}

const handlePriceRangeInput = (
  field: PriceRangeField,
  bound: 'min' | 'max',
  value: number | string | null | undefined,
) => {
  const normalizedValue = typeof value === 'number' ? value : null
  props.onPriceRangeChange?.(field, bound, normalizedValue)
}

const hasActiveRange = (field: PriceRangeField): boolean => {
  const range = props.priceRanges[field]
  return range.min != null || range.max != null
}

const formatRangeValue = (value: number | null): string => {
  if (value == null) return ''
  return parseFloat(value.toFixed(4)).toString()
}

const getRangeSummary = (field: PriceRangeField): string => {
  const range = props.priceRanges[field]
  const min = range.min
  const max = range.max

  if (min != null && max != null) return `${formatRangeValue(min)} ~ ${formatRangeValue(max)}`
  if (min != null) return `≥ ${formatRangeValue(min)}`
  if (max != null) return `≤ ${formatRangeValue(max)}`
  return ''
}

const getPricingTypeSummary = (): string => {
  if (props.pricingTypeFilter === 'token-based') return t('apiDoc.tokenBased')
  if (props.pricingTypeFilter === 'per-request') return t('apiDoc.perRequest')
  return ''
}

const getTooltipMultiplier = (_item: PricingModelRow, channel: RelayChannelOptionDto): number => {
  return channel.multiplier ?? 1
}

const isAutomaticProxyPool = (channel: RelayChannelOptionDto): boolean =>
  Boolean(channel.automaticProxyPool)

const isPooledChannel = (channel: RelayChannelOptionDto): boolean => Boolean(channel.poolPricing)

const getPoolLabel = (channel: RelayChannelOptionDto): string =>
  channel.channelType === 'automatic-proxy-pool'
    ? t('apiDoc.automaticProxyPool')
    : t('relay.channelTypePooled')

const getRoutingStrategyLabel = (channel: RelayChannelOptionDto): string => {
  const strategy = channel.automaticProxyPool?.routingStrategy
  if (!strategy) return '-'

  const labels: Record<NonNullable<typeof strategy>, string> = {
    priority: t('relay.routingStrategyPriority'),
    random: t('relay.routingStrategyRandom'),
    'weighted-random': t('relay.routingStrategyWeightedRandom'),
    'round-robin': t('relay.routingStrategyRoundRobin'),
    'health-priority': t('relay.routingStrategyHealthPriority'),
    'latency-priority': t('relay.routingStrategyLatencyPriority'),
  }

  return labels[strategy]
}

const getPoolPricingMembers = (channel: RelayChannelOptionDto) =>
  [...(channel.poolPricing?.members || [])].sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  )

const getTooltipMultiplierLabel = (
  item: PricingModelRow,
  channel: RelayChannelOptionDto,
): string => {
  return formatMultiplier(getTooltipMultiplier(item, channel))
}

const isSelectedChannel = (channelId: string): boolean => selectedChannelIdSet.value.has(channelId)

const formatChannelTokenPrice = (basePrice?: number, multiplier?: number): string => {
  const divisor = props.tokenPriceUnit === 'K' ? 1000 : 1
  const price = ((basePrice ?? 0) * (multiplier ?? 1)) / divisor
  return price.toFixed(props.tokenPriceUnit === 'K' ? 4 : 2)
}

const formatChannelFixedPrice = (basePrice?: number, multiplier?: number): string => {
  const price = (basePrice ?? 0) * (multiplier ?? 1)
  return price.toFixed(4)
}

const formatComparableTokenPrice = (value: number | null): string => {
  if (value == null) return '-'
  return value.toFixed(props.tokenPriceUnit === 'K' ? 4 : 2)
}

const formatComparableFixedPrice = (value: number | null): string => {
  if (value == null) return '-'
  return value.toFixed(4)
}

const formatMultiplierRange = (minimum: number, maximum: number | null): string => {
  if (maximum == null || minimum === maximum) return `×${formatMultiplier(minimum)}`
  return `×${formatMultiplier(minimum)}–×${formatMultiplier(maximum)}`
}

const formatComparableTokenPriceRange = (
  minimum: number | null,
  maximum: number | null,
): string => {
  if (maximum == null || minimum === maximum) return formatComparableTokenPrice(minimum)
  return `${formatComparableTokenPrice(minimum)}–${formatComparableTokenPrice(maximum)}`
}

const formatComparableFixedPriceRange = (
  minimum: number | null,
  maximum: number | null,
): string => {
  if (maximum == null || minimum === maximum) return formatComparableFixedPrice(minimum)
  return `${formatComparableFixedPrice(minimum)}–${formatComparableFixedPrice(maximum)}`
}

const errorMessage = computed(() => props.errorMessage || '')

const copyModelId = (item: PricingModelRow) => {
  const modelId = getModelId(item)
  props.onCopyModelId(modelId)
}

const getHighlightParts = (rawText?: string) => props.getHighlightParts(rawText)

const normalizeFormats = (formats?: string) => props.normalizeFormats(formats)

const formatCacheMultiplier = (creation?: number, read?: number): string => {
  const creationLabel = `${t('apiDoc.cacheCreateShort')}×${formatMultiplier(creation ?? 1)}`
  const readLabel = `${t('apiDoc.cacheReadShort')}×${formatMultiplier(read ?? 1)}`
  return `${creationLabel} / ${readLabel}`
}

const getAvailableChannels = (item: PricingModelRow): RelayChannelOptionDto[] =>
  props.getChannelsForModel(
    (item.model || '').trim(),
    props.getRequestModelId(item),
    item.supportedFormats,
  )

const getChannelPriceCellValue = (
  item: PricingModelRow,
  channel: RelayChannelOptionDto,
): ChannelPriceCell => {
  return props.getChannelPriceCell(item, channel)
}

const getAutomaticPoolMemberPrice = (
  item: PricingModelRow,
  channel: RelayChannelOptionDto,
  memberId: string,
) => getChannelPriceCellValue(item, channel).members.find((member) => member.id === memberId)
</script>

<style scoped>
.pricing-table-wrapper {
  width: 100%;
}

.automatic-pool-member {
  padding: 8px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}

.automatic-pool-member__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
}

.automatic-pool-member__meta,
.automatic-pool-member__price {
  margin-top: 3px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.pricing-table-empty-state {
  padding: 24px 0;
}

.column-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.column-header--right {
  align-items: flex-end;
}

.column-header-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
}

.column-header-actions--right {
  justify-content: flex-end;
}

.column-header-note {
  display: block;
  font-size: 10px;
  font-weight: 400;
  line-height: 1.2;
  text-align: inherit;
}

.column-header-filter-summary {
  display: block;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  text-align: inherit;
}

.column-header-button {
  width: 22px;
  height: 22px;
  min-height: 22px;
  padding: 0;
}

.comparison-column-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.comparison-column-header__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  width: 100%;
}

.comparison-column-header__title {
  min-width: 0;
  line-height: 1.35;
}

.price-filter-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.price-filter-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.price-filter-input {
  width: 100%;
}

.price-filter-actions {
  display: flex;
  justify-content: flex-end;
}

.model-cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-id-section {
  display: flex;
  align-items: center;
  gap: 6px;
}

.model-id-link {
  font-size: 15px;
}

.model-name-section {
  padding-left: 2px;
}

.highlight-match {
  background: #ffe58f;
  color: inherit;
  border-radius: 3px;
  padding: 0 2px;
}

.channels-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  align-content: flex-start;
  min-height: 28px;
}

.channel-tag {
  transition: opacity 0.15s;
}

.channel-tag:hover {
  opacity: 0.85;
}

.channel-multiplier-badge {
  font-size: 10px;
  opacity: 0.65;
  margin-left: 2px;
  font-weight: 400;
}

.channel-price-tooltip {
  font-size: 13px;
  line-height: 1.7;
  min-width: 180px;
  max-width: 260px;
  padding: 2px 0;
}

.channel-price-header {
  font-weight: 600;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-primary);
}

.channel-price-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.channel-price-row--stacked {
  align-items: flex-start;
}

.token-price-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.comparison-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.comparison-multiplier-row {
  width: 100%;
  display: flex;
  justify-content: flex-end;
}

.comparison-price-block {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.comparison-price-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.comparison-card-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.comparison-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-bg-color);
  padding: 14px;
}

.comparison-card__header {
  margin-bottom: 12px;
}

.comparison-card__channels {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.comparison-channel-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--el-fill-color-blank);
}

.comparison-channel-card__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.comparison-channel-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.comparison-price-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.token-price-tooltip-value {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.cache-multiplier-text {
  line-height: 1.2;
}

.channel-price-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  flex-shrink: 0;
}

.channel-price-hint {
  margin-top: 6px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 5px;
}

.empty-cell {
  color: #909399;
  font-size: 12px;
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
</style>
