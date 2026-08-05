<template>
  <div class="transaction-history">
    <div class="filter-section">
      <el-select
        v-model="localFilters.type"
        :placeholder="i18ns.t('balance.allTypes')"
        clearable
        :style="isDesktop ? { width: '180px' } : { width: '100%' }"
      >
        <el-option :label="i18ns.t('balance.redemption')" value="redemption" />
        <el-option :label="i18ns.t('nav.chat')" value="chat_usage" />
        <el-option :label="i18ns.t('balance.apiUsage')" value="api_usage" />
        <el-option :label="i18ns.t('balance.monthlyPassCoverage')" value="monthly_pass_coverage" />
        <el-option :label="i18ns.t('balance.giftCode')" value="gift_code_create" />
        <el-option :label="i18ns.t('balance.directTransfer')" value="peer_transfer_out" />
        <el-option :label="i18ns.t('balance.adminAdjustment')" value="recharge" />
      </el-select>
      <el-select
        v-model="localFilters.tokenName"
        :placeholder="i18ns.t('balance.selectToken')"
        clearable
        :style="isDesktop ? { width: '180px' } : { width: '100%' }"
      >
        <el-option v-for="token in availableTokens" :key="token" :label="token" :value="token" />
      </el-select>
      <el-select
        v-model="localFilters.displayChannelName"
        :placeholder="i18ns.t('balance.selectChannel')"
        clearable
        :style="isDesktop ? { width: '180px' } : { width: '100%' }"
      >
        <el-option
          v-for="channel in availableChannels"
          :key="channel"
          :label="channel"
          :value="channel"
        />
      </el-select>
      <el-input
        v-model="localFilters.model"
        :placeholder="i18ns.t('balance.selectModel')"
        clearable
        :style="isDesktop ? { width: '180px' } : { width: '100%' }"
      />
      <!-- 桌面端：范围选择器 -->
      <el-date-picker
        v-if="isDesktop"
        v-model="dateRange"
        type="datetimerange"
        :start-placeholder="i18ns.t('balance.startDate')"
        :end-placeholder="i18ns.t('balance.endDate')"
        style="width: 100%; max-width: 380px"
        format="YYYY-MM-DD HH:mm:ss"
        value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
        @change="handleDateChange"
      />
      <!-- 手机端：两个独立选择器 -->
      <template v-else>
        <el-date-picker
          v-model="localFilters.startTime"
          type="datetime"
          :placeholder="i18ns.t('balance.startDate')"
          style="width: 100%"
          format="MM-DD HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
        />
        <el-date-picker
          v-model="localFilters.endTime"
          type="datetime"
          :placeholder="i18ns.t('balance.endDate')"
          style="width: 100%"
          format="MM-DD HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
        />
      </template>
      <el-button
        :icon="Refresh"
        :disabled="props.loadingFull"
        :loading="props.loadingFull"
        @click="emit('refresh')"
        >{{ i18ns.t('refresh') }}</el-button
      >
      <template v-if="props.rangeSlider">
        <div class="range-slider-group">
          <span class="range-action-group__label">{{ i18ns.t('balance.loadRange') }}</span>
          <div class="range-slider-group__control">
            <el-segmented
              v-model="rangeSliderValue"
              :disabled="props.loadingFull"
              :options="rangeSliderOptions"
              block
            />
          </div>
          <span v-if="props.rangeHint" class="range-action-group__hint">{{ props.rangeHint }}</span>
        </div>
      </template>
      <template v-else-if="props.rangeActions?.length">
        <div class="range-action-group">
          <span class="range-action-group__label">{{ i18ns.t('balance.loadRange') }}</span>
          <div class="range-action-group__control">
            <el-segmented
              v-model="rangeActionValue"
              :options="rangeActionOptions"
              block
              :disabled="props.loadingFull"
            />
          </div>
          <span v-if="props.rangeHint" class="range-action-group__hint">{{ props.rangeHint }}</span>
        </div>
      </template>
      <div style="margin-left: auto">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="table">{{ i18ns.t('table') }}</el-radio-button>
          <el-radio-button value="chart">{{ i18ns.t('chart') }}</el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <div
      v-if="viewMode === 'table'"
      v-loading="loading"
      :element-loading-text="loading ? i18ns.t('relay.firstLoadTip') : ''"
    >
      <el-table
        v-if="isDesktop"
        ref="desktopTableRef"
        :data="paginatedTransactions"
        stripe
        @expand-change="handleExpandChange"
      >
        <el-table-column type="expand">
          <template #default="{ row }">
            <transition name="transaction-expand" appear>
              <div
                :id="getExpandContentId(row)"
                class="expand-content"
                role="region"
                tabindex="-1"
                :aria-labelledby="getExpandTriggerId(row)"
                @keydown.esc.stop.prevent="handleExpandRegionEscape(row)"
              >
                <div class="expand-section">
                  <div v-if="row.description" style="margin-bottom: 12px">
                    {{ row.description }}
                  </div>
                  <template v-if="hasBillingDetails(row)">
                    <el-descriptions :column="3" border>
                      <el-descriptions-item
                        v-if="hasNumericValue(row.inputTokens)"
                        :label="i18ns.t('balance.inputTokens')"
                        >{{ formatTokenCount(row.inputTokens) }}</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="hasNumericValue(row.outputTokens)"
                        :label="i18ns.t('balance.outputTokens')"
                        >{{ formatTokenCount(row.outputTokens) }}</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="row.cacheCreationTokens"
                        :label="i18ns.t('balance.cacheCreationTokens')"
                        >{{ row.cacheCreationTokens?.toLocaleString() }}</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="row.cacheReadTokens"
                        :label="i18ns.t('balance.cacheReadTokens')"
                        >{{ row.cacheReadTokens?.toLocaleString() }}</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="row.inputRate != null"
                        :label="i18ns.t('balance.inputPrice')"
                        >{{ formatRatePerMillion(row.inputRate) }}
                        {{ i18ns.t('balance.priceUnitOfM') }}</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="row.outputRate != null"
                        :label="i18ns.t('balance.outputPrice')"
                        >{{ formatRatePerMillion(row.outputRate) }}
                        {{ i18ns.t('balance.priceUnitOfM') }}</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="shouldShowCacheCreationMultiplier(row)"
                        :label="i18ns.t('balance.cacheCreationMultiplier')"
                        >{{
                          row.cacheCreationMultiplier ?? CACHE_CREATION_MULTIPLIER
                        }}×</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="shouldShowCacheReadMultiplier(row)"
                        :label="i18ns.t('balance.cacheReadMultiplier')"
                        >{{
                          row.cacheReadMultiplier ?? CACHE_READ_MULTIPLIER
                        }}×</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="row.displayChannelName"
                        :label="i18ns.t('balance.channelUsed')"
                        >{{ row.displayChannelName }}</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="row.requestId"
                        :label="i18ns.t('balance.requestId')"
                      >
                        <span class="request-id-value">
                          <code>{{ row.requestId }}</code>
                          <el-tooltip :content="i18ns.t('copy')" placement="top">
                            <el-button
                              text
                              size="small"
                              :icon="DocumentCopy"
                              @click.stop="copyRequestId(row.requestId)"
                            />
                          </el-tooltip>
                        </span>
                      </el-descriptions-item>
                      <el-descriptions-item
                        v-if="shouldShowModelMultiplier(row)"
                        :label="i18ns.t('balance.modelMultiplier')"
                        >{{ resolveModelMultiplier(row) }}×</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="shouldShowGlobalMultiplier(row)"
                        :label="i18ns.t('balance.globalMultiplier')"
                        >{{ resolveGlobalMultiplier(row) }}×</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="shouldShowChannelMultiplier(row)"
                        :label="i18ns.t('balance.channelMultiplier')"
                        >{{ resolveChannelMultiplier(row) }}×</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="shouldShowTimeMultiplier(row)"
                        :label="i18ns.t('balance.timeMultiplier')"
                        >{{ resolveTimeMultiplier(row) }}×</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="row.contextTokens != null"
                        :label="i18ns.t('balance.contextTokens')"
                        >{{ row.contextTokens.toLocaleString() }}</el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="shouldShowContextMultiplier(row)"
                        :label="i18ns.t('balance.contextMultiplier')"
                        >{{ resolveContextMultiplier(row) }}×<template v-if="row.contextRuleName">
                          · {{ row.contextRuleName }}</template
                        ></el-descriptions-item
                      >
                      <el-descriptions-item
                        v-if="shouldShowMultiplier(row)"
                        :label="i18ns.t('balance.multiplier')"
                        >{{ resolveEffectiveMultiplier(row) }}×</el-descriptions-item
                      >
                    </el-descriptions>
                    <div v-if="canShowFormula(row)" class="calc-formula">
                      {{ getBillingFormulaText(row) }}
                    </div>
                  </template>
                </div>
              </div>
            </transition>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('balance.transactionType')" min-width="25">
          <template #default="{ row }">
            <el-tag
              v-if="getTransactionCategory(row) === 'redemption'"
              type="success"
              size="small"
              >{{ i18ns.t('balance.redemption') }}</el-tag
            >
            <el-tag
              v-else-if="getTransactionCategory(row) === 'chat_usage'"
              type="warning"
              size="small"
              >{{ i18ns.t('nav.chat') }}</el-tag
            >
            <el-tag
              v-else-if="getTransactionCategory(row) === 'api_usage'"
              type="warning"
              size="small"
              >{{ i18ns.t('balance.apiUsage') }}</el-tag
            >
            <el-tag
              v-else-if="getTransactionCategory(row) === 'monthly_pass_coverage'"
              type="success"
              size="small"
              >{{ i18ns.t('balance.monthlyPassCoverage') }}</el-tag
            >
            <el-tag
              v-else-if="getTransactionCategory(row).startsWith('gift_code')"
              type="success"
              size="small"
              >{{ i18ns.t('balance.giftCode') }}</el-tag
            >
            <el-tag
              v-else-if="getTransactionCategory(row).startsWith('peer_transfer')"
              type="primary"
              size="small"
              >{{ i18ns.t('balance.directTransfer') }}</el-tag
            >
            <el-tag v-else type="info" size="small">{{
              i18ns.t('balance.adminAdjustment')
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('balance.tokenName')" min-width="40">
          <template #default="{ row }">
            <span v-if="row.tokenName">{{ row.tokenName }}</span>
            <span v-else style="color: var(--el-text-color-placeholder)">-</span>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('balance.channelUsed')" min-width="40">
          <template #default="{ row }">
            <span v-if="row.displayChannelName">{{ row.displayChannelName }}</span>
            <span v-else style="color: var(--el-text-color-placeholder)">-</span>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('balance.channelMultiplier')" width="108" align="right">
          <template #default="{ row }">
            <span :class="{ 'text-placeholder': !hasNumericValue(row.channelMultiplier) }">
              {{ formatMultiplier(row.channelMultiplier) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('balance.model')" min-width="50">
          <template #default="{ row }">
            <span v-if="getModelDisplay(row)">{{ getModelDisplay(row) }}</span>
            <span v-else style="color: var(--el-text-color-placeholder)">-</span>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('balance.performanceMetrics')" class-name="hide-on-mobile">
          <template #default="{ row }">
            <div v-if="hasPerformanceMetrics(row)" class="timing-metrics">
              <span v-if="hasNumericValue(row.totalOutputTime)" class="metric-badge">
                <span class="metric-badge__label">{{ i18ns.t('balance.totalOutputTime') }}</span>
                <span class="metric-badge__value">{{ row.totalOutputTime }}ms</span>
              </span>
              <span v-if="hasNumericValue(row.timeToFirstByte)" class="metric-badge">
                <span class="metric-badge__label">{{ i18ns.t('balance.timeToFirstByte') }}</span>
                <span class="metric-badge__value">{{ row.timeToFirstByte }}ms</span>
              </span>
              <span
                v-if="row.isStreaming !== undefined"
                :class="[
                  'stream-badge',
                  row.isStreaming ? 'stream-badge--yes' : 'stream-badge--no',
                ]"
              >
                <span class="stream-dot"></span>
                {{
                  row.isStreaming ? i18ns.t('balance.streamingYes') : i18ns.t('balance.streamingNo')
                }}
              </span>
            </div>
            <span v-else style="color: var(--el-text-color-placeholder)">-</span>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('balance.amount')" min-width="25">
          <template #default="{ row }">
            <el-tooltip
              v-if="isMonthlyPassCoverage(row)"
              :content="getMonthlyPassTooltip(row)"
              placement="top"
            >
              <span :class="getAmountClass(row)">
                {{ getAmountText(row) }}
              </span>
            </el-tooltip>
            <el-tooltip
              v-else-if="isZeroChargeUpstreamError(row)"
              :content="getZeroChargeTooltip(row)"
              placement="top"
            >
              <span :class="getAmountClass(row)">
                {{ getAmountText(row) }}
              </span>
            </el-tooltip>
            <span v-else :class="getAmountClass(row)">
              {{ getAmountText(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="balanceAfter" :label="i18ns.t('balance.after')" min-width="25" />
        <el-table-column :label="i18ns.t('relay.createTime')" min-width="50">
          <template #default="{ row }">
            {{ new Date(row.createTime).toLocaleString() }}
          </template>
        </el-table-column>
      </el-table>

      <!-- 手机端卡片列表 -->
      <div v-if="!isDesktop" class="mobile-card-list">
        <el-card v-for="row in paginatedTransactions" :key="row.id" class="tx-card">
          <div class="tx-card-header">
            <el-tag
              v-if="getTransactionCategory(row) === 'redemption'"
              type="success"
              size="small"
              >{{ i18ns.t('balance.redemption') }}</el-tag
            >
            <el-tag
              v-else-if="getTransactionCategory(row) === 'chat_usage'"
              type="warning"
              size="small"
              >{{ i18ns.t('nav.chat') }}</el-tag
            >
            <el-tag
              v-else-if="getTransactionCategory(row) === 'api_usage'"
              type="warning"
              size="small"
              >{{ i18ns.t('balance.apiUsage') }}</el-tag
            >
            <el-tag
              v-else-if="getTransactionCategory(row) === 'monthly_pass_coverage'"
              type="success"
              size="small"
              >{{ i18ns.t('balance.monthlyPassCoverage') }}</el-tag
            >
            <el-tag
              v-else-if="getTransactionCategory(row).startsWith('gift_code')"
              type="success"
              size="small"
              >{{ i18ns.t('balance.giftCode') }}</el-tag
            >
            <el-tag
              v-else-if="getTransactionCategory(row).startsWith('peer_transfer')"
              type="primary"
              size="small"
              >{{ i18ns.t('balance.directTransfer') }}</el-tag
            >
            <el-tag v-else type="info" size="small">{{
              i18ns.t('balance.adminAdjustment')
            }}</el-tag>
            <el-tooltip
              v-if="isMonthlyPassCoverage(row)"
              :content="getMonthlyPassTooltip(row)"
              placement="top"
            >
              <span :class="getAmountClass(row)">
                {{ getAmountText(row) }}
              </span>
            </el-tooltip>
            <el-tooltip
              v-else-if="isZeroChargeUpstreamError(row)"
              :content="getZeroChargeTooltip(row)"
              placement="top"
            >
              <span :class="getAmountClass(row)">
                {{ getAmountText(row) }}
              </span>
            </el-tooltip>
            <span v-else :class="getAmountClass(row)">
              {{ getAmountText(row) }}
            </span>
          </div>
          <div class="tx-card-body">
            <div v-if="getModelDisplay(row)" class="tx-card-row">
              <span class="tx-label">{{ i18ns.t('balance.model') }}</span>
              <span class="tx-value">{{ getModelDisplay(row) }}</span>
            </div>
            <div v-if="row.tokenName" class="tx-card-row">
              <span class="tx-label">{{ i18ns.t('balance.tokenName') }}</span>
              <span class="tx-value">{{ row.tokenName }}</span>
            </div>
            <div v-if="row.displayChannelName" class="tx-card-row">
              <span class="tx-label">{{ i18ns.t('balance.channelUsed') }}</span>
              <span class="tx-value">{{ row.displayChannelName }}</span>
            </div>
            <div v-if="hasNumericValue(row.channelMultiplier)" class="tx-card-row">
              <span class="tx-label">{{ i18ns.t('balance.channelMultiplier') }}</span>
              <span class="tx-value">{{ formatMultiplier(row.channelMultiplier) }}</span>
            </div>
            <div v-if="row.requestId" class="tx-card-row">
              <span class="tx-label">{{ i18ns.t('balance.requestId') }}</span>
              <span class="tx-value request-id-value">
                <code>{{ row.requestId }}</code>
                <el-tooltip :content="i18ns.t('copy')" placement="top">
                  <el-button
                    text
                    size="small"
                    :icon="DocumentCopy"
                    @click.stop="copyRequestId(row.requestId)"
                  />
                </el-tooltip>
              </span>
            </div>
            <div class="tx-card-row">
              <span class="tx-label">{{ i18ns.t('balance.after') }}</span>
              <span class="tx-value">{{ row.balanceAfter }}</span>
            </div>
            <div
              v-if="hasTokenDetails(row) && hasNumericValue(row.inputTokens)"
              class="tx-card-row"
            >
              <span class="tx-label">{{ i18ns.t('balance.inputTokens') }}</span>
              <span class="tx-value">{{ formatTokenCount(row.inputTokens) }}</span>
            </div>
            <div
              v-if="hasTokenDetails(row) && hasNumericValue(row.outputTokens)"
              class="tx-card-row"
            >
              <span class="tx-label">{{ i18ns.t('balance.outputTokens') }}</span>
              <span class="tx-value">{{ formatTokenCount(row.outputTokens) }}</span>
            </div>
            <div v-if="hasPerformanceMetrics(row)" class="tx-card-row">
              <span class="tx-label">{{ i18ns.t('balance.performanceMetrics') }}</span>
              <span class="tx-value">
                <span v-if="hasNumericValue(row.totalOutputTime)" class="metric-badge">
                  <span class="metric-badge__label">{{ i18ns.t('balance.totalOutputTime') }}</span>
                  <span class="metric-badge__value">{{ row.totalOutputTime }}ms</span>
                </span>
                <span v-if="hasNumericValue(row.timeToFirstByte)" class="metric-badge">
                  <span class="metric-badge__label">{{ i18ns.t('balance.timeToFirstByte') }}</span>
                  <span class="metric-badge__value">{{ row.timeToFirstByte }}ms</span>
                </span>
                <span
                  v-if="row.isStreaming !== undefined"
                  :class="[
                    'stream-badge',
                    row.isStreaming ? 'stream-badge--yes' : 'stream-badge--no',
                  ]"
                >
                  <span class="stream-dot"></span>
                  {{
                    row.isStreaming
                      ? i18ns.t('balance.streamingYes')
                      : i18ns.t('balance.streamingNo')
                  }}
                </span>
              </span>
            </div>
            <div class="tx-card-row">
              <span class="tx-label">{{ i18ns.t('relay.createTime') }}</span>
              <span class="tx-value">{{ new Date(row.createTime).toLocaleString() }}</span>
            </div>

            <!-- 计费详情折叠 -->
            <el-collapse
              v-if="row.description || hasBillingDetails(row)"
              class="detail-collapse"
              style="margin-top: 12px"
            >
              <el-collapse-item :title="i18ns.t('balance.details')" name="1">
                <div class="mobile-billing-details">
                  <div v-if="row.description" class="detail-row">
                    <span>{{ i18ns.t('balance.description') }}:</span>
                    <span>{{ row.description }}</span>
                  </div>
                  <template v-if="hasBillingDetails(row)">
                    <div v-if="row.inputRate != null" class="detail-row">
                      <span>{{ i18ns.t('balance.inputPrice') }}:</span>
                      <span
                        >{{ formatRatePerMillion(row.inputRate) }}
                        {{ i18ns.t('balance.priceUnitOfM') }}</span
                      >
                    </div>
                    <div v-if="row.outputRate != null" class="detail-row">
                      <span>{{ i18ns.t('balance.outputPrice') }}:</span>
                      <span
                        >{{ formatRatePerMillion(row.outputRate) }}
                        {{ i18ns.t('balance.priceUnitOfM') }}</span
                      >
                    </div>
                    <div v-if="row.cacheCreationTokens" class="detail-row">
                      <span>{{ i18ns.t('balance.cacheCreationTokens') }}:</span>
                      <span>{{ row.cacheCreationTokens?.toLocaleString() }}</span>
                    </div>
                    <div v-if="row.cacheReadTokens" class="detail-row">
                      <span>{{ i18ns.t('balance.cacheReadTokens') }}:</span>
                      <span>{{ row.cacheReadTokens?.toLocaleString() }}</span>
                    </div>
                    <div v-if="shouldShowCacheCreationMultiplier(row)" class="detail-row">
                      <span>{{ i18ns.t('balance.cacheCreationMultiplier') }}:</span>
                      <span>{{ row.cacheCreationMultiplier ?? CACHE_CREATION_MULTIPLIER }}×</span>
                    </div>
                    <div v-if="shouldShowCacheReadMultiplier(row)" class="detail-row">
                      <span>{{ i18ns.t('balance.cacheReadMultiplier') }}:</span>
                      <span>{{ row.cacheReadMultiplier ?? CACHE_READ_MULTIPLIER }}×</span>
                    </div>
                    <div v-if="shouldShowModelMultiplier(row)" class="detail-row">
                      <span>{{ i18ns.t('balance.modelMultiplier') }}:</span>
                      <span>{{ resolveModelMultiplier(row) }}×</span>
                    </div>
                    <div v-if="shouldShowGlobalMultiplier(row)" class="detail-row">
                      <span>{{ i18ns.t('balance.globalMultiplier') }}:</span>
                      <span>{{ resolveGlobalMultiplier(row) }}×</span>
                    </div>
                    <div v-if="shouldShowChannelMultiplier(row)" class="detail-row">
                      <span>{{ i18ns.t('balance.channelMultiplier') }}:</span>
                      <span>{{ resolveChannelMultiplier(row) }}×</span>
                    </div>
                    <div v-if="shouldShowTimeMultiplier(row)" class="detail-row">
                      <span>{{ i18ns.t('balance.timeMultiplier') }}:</span>
                      <span>{{ resolveTimeMultiplier(row) }}×</span>
                    </div>
                    <div v-if="row.contextTokens != null" class="detail-row">
                      <span>{{ i18ns.t('balance.contextTokens') }}:</span>
                      <span>{{ row.contextTokens.toLocaleString() }}</span>
                    </div>
                    <div v-if="shouldShowContextMultiplier(row)" class="detail-row">
                      <span>{{ i18ns.t('balance.contextMultiplier') }}:</span>
                      <span
                        >{{ resolveContextMultiplier(row) }}×<template v-if="row.contextRuleName">
                          · {{ row.contextRuleName }}</template
                        ></span
                      >
                    </div>
                    <div v-if="shouldShowMultiplier(row)" class="detail-row">
                      <span>{{ i18ns.t('balance.multiplier') }}:</span>
                      <span>{{ resolveEffectiveMultiplier(row) }}×</span>
                    </div>
                    <div v-if="canShowFormula(row)" class="calc-formula" style="margin-top: 8px">
                      {{ getBillingFormulaText(row) }}
                    </div>
                  </template>
                </div>
              </el-collapse-item>
            </el-collapse>
          </div>
        </el-card>
      </div>

      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        style="margin-top: 16px; justify-content: center"
      />
    </div>

    <div v-else v-loading="loading" class="chart-view">
      <div
        class="hourly-consumption-chart"
        style="
          margin-bottom: 20px;
          padding: 16px;
          background: var(--el-bg-color);
          border-radius: 8px;
        "
      >
        <v-chart :option="hourlyConsumptionChartOption" style="height: 350px; width: 100%" />
      </div>
      <div class="charts-container">
        <div class="chart-item">
          <v-chart :option="balanceChartOption" style="height: 350px; width: 100%" />
        </div>
        <div class="chart-item">
          <v-chart :option="spendingChartOption" style="height: 350px; width: 100%" />
        </div>
        <div class="chart-item">
          <v-chart :option="typeChartOption" style="height: 350px; width: 100%" />
        </div>
        <div class="chart-item">
          <v-chart :option="modelChartOption" style="height: 350px; width: 100%" />
        </div>
        <div class="chart-item">
          <v-chart :option="tokenUsageChartOption" style="height: 350px; width: 100%" />
        </div>
        <div class="chart-item">
          <v-chart :option="dailyBalanceChangeChartOption" style="height: 350px; width: 100%" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { CSSProperties } from 'vue'
import { usePageDevice } from '@/composables/usePageDevice'
import { i18ns } from '@/locales'
import { DocumentCopy, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { BalanceTransactionResponse } from '@/client/types.gen'
import type { TableInstance } from 'element-plus'
import { AsyncVChart as VChart } from '@/utils/asyncChart'
import { copyTextWithFallback } from '@/utils/clipboard'
import {
  buildBillingFormula,
  CACHE_CREATION_MULTIPLIER,
  CACHE_READ_MULTIPLIER,
  hasFormulaFields,
  hasPerRequestFormulaFields,
  resolveChannelMultiplier,
  resolveEffectiveMultiplier,
  resolveGlobalMultiplier,
  resolveModelMultiplier,
  resolveContextMultiplier,
  resolveTimeMultiplier,
  shouldShowChannelMultiplier,
  shouldShowCacheCreationMultiplier,
  shouldShowCacheReadMultiplier,
  shouldShowGlobalMultiplier,
  shouldShowModelMultiplier,
  shouldShowMultiplier,
  shouldShowContextMultiplier,
  shouldShowTimeMultiplier,
} from '@/composables/useBillingFormula'
import {
  extractMonthlyPassCoveredAmount,
  getTransactionCategory,
  isChargeableApiUsageRecord,
  isMonthlyPassCoverage,
  isZeroChargeUpstreamError,
} from '@/utils/balance-transaction'

const props = defineProps<{
  transactions: BalanceTransactionResponse[]
  loading?: boolean
  loadingFull?: boolean
  activeRangeKey?: string
  rangeHint?: string
  rangeSlider?: {
    value: number
    min: number
    max: number
    marks: Record<number, string | { label: string; style?: CSSProperties }>
  }
  rangeActions?: Array<{
    key: string
    label: string
    disabled?: boolean
  }>
}>()

const emit = defineEmits<{
  refresh: []
  rangeAction: [key: string]
  rangeSliderChange: [value: number]
}>()

const { isDesktop } = usePageDevice()

const copyRequestId = async (requestId: string) => {
  const copied = await copyTextWithFallback(requestId)
  if (copied) ElMessage.success(i18ns.t('copySuccess'))
  else ElMessage.error(i18ns.t('copyFailed'))
}
const desktopTableRef = ref<TableInstance>()
const viewMode = ref('table')
const localFilters = ref({
  type: '',
  model: '',
  tokenName: '',
  displayChannelName: '',
  startTime: '',
  endTime: '',
})
const dateRange = ref<[Date, Date] | null>(null)
const pagination = ref({ page: 1, pageSize: 20, total: 0 })

const rangeSliderValue = computed<number>({
  get: () => props.rangeSlider?.value ?? 0,
  set: (value) => {
    const clampedValue = clampRangeSliderValue(value)
    if (clampedValue === (props.rangeSlider?.value ?? 0)) return
    emit('rangeSliderChange', clampedValue)
  },
})

const rangeActionOptions = computed(
  () =>
    props.rangeActions?.map((action) => ({
      label: action.label,
      value: action.key,
      disabled: action.disabled,
    })) ?? [],
)

const rangeActionValue = computed<string>({
  get: () => props.activeRangeKey ?? props.rangeActions?.[0]?.key ?? '',
  set: (value) => {
    if (typeof value === 'string') emit('rangeAction', value)
  },
})

const rangeSliderOptions = computed(() => {
  const slider = props.rangeSlider
  if (!slider) return []

  const options: Array<{ label: string; value: number; disabled?: boolean }> = []

  for (let value = slider.min; value <= slider.max; value += 1) {
    const mark = slider.marks[value]
    const label = typeof mark === 'string' ? mark : (mark?.label ?? String(value))
    options.push({
      label,
      value,
    })
  }

  return options
})

const clampRangeSliderValue = (value: number): number =>
  Math.min(Math.max(value, props.rangeSlider?.min ?? 0), props.rangeSlider?.max ?? value)

const formatAmountNumber = (amount: number): string => {
  if (!Number.isFinite(amount)) return '0'
  return Number(amount.toFixed(4)).toString()
}

const getMonthlyPassTooltip = (tx: BalanceTransactionResponse): string =>
  tx.description || i18ns.t('balance.monthlyPassCoverage')

const getZeroChargeTooltip = (tx: BalanceTransactionResponse): string =>
  tx.description || i18ns.t('balance.upstreamErrorNoCharge')

const getAmountClass = (tx: BalanceTransactionResponse): string => {
  if (isMonthlyPassCoverage(tx)) return 'amount-covered'
  if (isZeroChargeUpstreamError(tx)) return 'amount-zero-charge'

  const numericAmount = Number(tx.amount)
  return numericAmount > 0 ? 'amount-positive' : 'amount-negative'
}

const getAmountText = (tx: BalanceTransactionResponse): string => {
  if (isMonthlyPassCoverage(tx)) {
    const coveredAmount = extractMonthlyPassCoveredAmount(tx.description)
    return coveredAmount == null
      ? i18ns.t('balance.monthlyPassCoverage')
      : `${formatAmountNumber(coveredAmount)} ${i18ns.t('balance.yuan')}`
  }

  const numericAmount = Number(tx.amount)
  const displayAmount = Number.isFinite(numericAmount) ? numericAmount : 0
  if (isZeroChargeUpstreamError(tx)) {
    return `${formatAmountNumber(displayAmount)} · ${i18ns.t('balance.noCharge')}`
  }

  return `${displayAmount > 0 ? '+' : ''}${formatAmountNumber(displayAmount)}`
}

const getModelDisplay = (tx: BalanceTransactionResponse): string => {
  if (tx.model) return tx.model
  const match = tx.description?.match(/AI对话\s*-\s*(.+)$/)
  return match?.[1]?.trim() || ''
}

const hasNumericValue = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const formatTokenCount = (value: number | null | undefined): string =>
  hasNumericValue(value) ? value.toLocaleString() : '-'

const formatMultiplier = (value: number | null | undefined): string =>
  hasNumericValue(value) && value > 0 ? `${value}×` : '-'

const hasTokenDetails = (tx: BalanceTransactionResponse): boolean =>
  hasNumericValue(tx.inputTokens) || hasNumericValue(tx.outputTokens)

const hasPerformanceMetrics = (tx: BalanceTransactionResponse): boolean => {
  const category = getTransactionCategory(tx)
  const isUsageLike =
    category === 'api_usage' || category === 'chat_usage' || category === 'monthly_pass_coverage'
  if (!isUsageLike) return false

  return (
    hasNumericValue(tx.totalOutputTime) ||
    hasNumericValue(tx.timeToFirstByte) ||
    tx.isStreaming !== undefined
  )
}

const hasBillingDetails = (tx: BalanceTransactionResponse): boolean =>
  [
    tx.inputTokens,
    tx.outputTokens,
    tx.inputRate,
    tx.outputRate,
    tx.pricingType,
    tx.fixedPrice,
    tx.cacheCreationTokens,
    tx.cacheReadTokens,
    tx.multiplier,
    tx.channelMultiplier,
    tx.globalMultiplier,
    tx.timeMultiplier,
    tx.contextTokens,
    tx.contextMultiplier,
    tx.cacheCreationMultiplier,
    tx.cacheReadMultiplier,
    tx.displayChannelName,
  ].some((value) => value !== undefined && value !== null)

const canShowFormula = (tx: BalanceTransactionResponse): boolean =>
  hasFormulaFields(tx) || hasPerRequestFormulaFields(tx)

const getBillingFormulaText = (tx: BalanceTransactionResponse): string =>
  buildBillingFormula(tx, i18ns.t('balance.yuan'))

const expandedRowIds = ref<Set<string>>(new Set())

const isRowExpanded = (row: BalanceTransactionResponse): boolean => expandedRowIds.value.has(row.id)

const buildExpandElementSuffix = (row: BalanceTransactionResponse): string =>
  String(row.id || '').replace(/[^a-zA-Z0-9_-]/g, '_')

const getExpandTriggerId = (row: BalanceTransactionResponse): string =>
  `transaction-expand-trigger-${buildExpandElementSuffix(row)}`

const getExpandContentId = (row: BalanceTransactionResponse): string =>
  `transaction-expand-${buildExpandElementSuffix(row)}`

const focusExpandContent = async (row: BalanceTransactionResponse) => {
  await nextTick()
  const region = document.getElementById(getExpandContentId(row))
  region?.focus()
}

const focusExpandTrigger = async (row: BalanceTransactionResponse) => {
  await nextTick()
  const trigger = document.getElementById(getExpandTriggerId(row))
  trigger?.focus()
}

const collapseExpandedRow = (row: BalanceTransactionResponse) => {
  if (!isRowExpanded(row)) return
  desktopTableRef.value?.toggleRowExpansion(row, false)
}

const handleExpandRegionEscape = async (row: BalanceTransactionResponse) => {
  collapseExpandedRow(row)
  await focusExpandTrigger(row)
}

const handleExpandChange = (
  _row: BalanceTransactionResponse,
  expandedRows: BalanceTransactionResponse[],
) => {
  const previousExpandedIds = expandedRowIds.value
  const nextExpandedIds = new Set(expandedRows.map((item) => item.id))
  expandedRowIds.value = nextExpandedIds

  const newlyExpandedRow = expandedRows.find((item) => !previousExpandedIds.has(item.id))
  if (newlyExpandedRow) {
    void focusExpandContent(newlyExpandedRow)
  }
}

const RATE_PER_MILLION_DIVISOR = 1_000_000
const LEGACY_PER_MILLION_RATE_THRESHOLD = 0.01

const formatRatePerMillion = (rate?: number): string => {
  if (rate == null) return '-'

  const numericRate = Number(rate)
  if (!Number.isFinite(numericRate)) return '-'

  // Legacy records may store rate as "per million token" already.
  const ratePerMillion =
    numericRate >= LEGACY_PER_MILLION_RATE_THRESHOLD
      ? numericRate
      : numericRate * RATE_PER_MILLION_DIVISOR

  return Number(ratePerMillion.toFixed(6)).toString()
}

const filterOptions = computed(() => {
  const tokens = new Set<string>()
  const channels = new Set<string>()

  props.transactions.forEach((transaction) => {
    if (transaction.tokenName) tokens.add(transaction.tokenName)
    if (transaction.displayChannelName) channels.add(transaction.displayChannelName)
  })

  return {
    tokens: Array.from(tokens).sort(),
    channels: Array.from(channels).sort(),
  }
})

const availableTokens = computed(() => filterOptions.value.tokens)

const availableChannels = computed(() => filterOptions.value.channels)

const filteredTransactions = computed(() => {
  let filtered = props.transactions
  if (localFilters.value.type)
    filtered = filtered.filter((t) => getTransactionCategory(t) === localFilters.value.type)
  if (localFilters.value.model)
    filtered = filtered.filter((t) => getModelDisplay(t).includes(localFilters.value.model))
  if (localFilters.value.tokenName)
    filtered = filtered.filter((t) => t.tokenName === localFilters.value.tokenName)
  if (localFilters.value.displayChannelName)
    filtered = filtered.filter(
      (t) => t.displayChannelName === localFilters.value.displayChannelName,
    )
  if (localFilters.value.startTime)
    filtered = filtered.filter(
      (t) => new Date(t.createTime) >= new Date(localFilters.value.startTime),
    )
  if (localFilters.value.endTime)
    filtered = filtered.filter(
      (t) => new Date(t.createTime) <= new Date(localFilters.value.endTime),
    )
  return filtered
})

watch(filteredTransactions, (newVal) => {
  pagination.value.total = newVal.length
  pagination.value.page = 1
})

const paginatedTransactions = computed(() => {
  const start = (pagination.value.page - 1) * pagination.value.pageSize
  return filteredTransactions.value.slice(start, start + pagination.value.pageSize)
})

const handleDateChange = (value: [string, string] | null) => {
  if (value) {
    localFilters.value.startTime = value[0]
    localFilters.value.endTime = value[1]
  } else {
    localFilters.value.startTime = ''
    localFilters.value.endTime = ''
  }
}

const balanceChartOption = computed(() => {
  const sortedData = [...filteredTransactions.value].sort(
    (a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime(),
  )
  return {
    title: { text: i18ns.t('balance.transactionHistory'), left: 'center' },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: sortedData.map((t) => new Date(t.createTime).toLocaleString()),
    },
    yAxis: { type: 'value' },
    series: [{ type: 'line', data: sortedData.map((t) => Number(t.balanceAfter)), smooth: true }],
  }
})

const spendingChartOption = computed(() => {
  const apiUsage = filteredTransactions.value
    .filter((t) => isChargeableApiUsageRecord(t))
    .sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime())
  const dailySpending = new Map<string, number>()
  apiUsage.forEach((t) => {
    const date = new Date(t.createTime).toLocaleDateString()
    dailySpending.set(date, (dailySpending.get(date) || 0) + Math.abs(Number(t.amount)))
  })
  return {
    title: { text: i18ns.t('balance.dailySpending'), left: 'center' },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: Array.from(dailySpending.keys()) },
    yAxis: { type: 'value' },
    series: [
      { type: 'bar', data: Array.from(dailySpending.values()).map((v) => Number(v.toFixed(2))) },
    ],
  }
})

const typeChartOption = computed(() => {
  const typeCount: Record<string, number> = {}
  filteredTransactions.value.forEach((t) => {
    const category = getTransactionCategory(t)
    typeCount[category] = (typeCount[category] || 0) + 1
  })
  const typeNameMap: Record<string, string> = {
    redemption: i18ns.t('balance.redemption'),
    chat_usage: i18ns.t('nav.chat'),
    api_usage: i18ns.t('balance.apiUsage'),
    monthly_pass_coverage: i18ns.t('balance.monthlyPassCoverage'),
    gift_code_create: i18ns.t('balance.giftCode'),
    gift_code_redeem: i18ns.t('balance.giftCode'),
    gift_code_cancel: i18ns.t('balance.giftCode'),
    peer_transfer_out: i18ns.t('balance.directTransfer'),
    peer_transfer_in: i18ns.t('balance.directTransfer'),
    recharge: i18ns.t('balance.adminAdjustment'),
  }
  return {
    title: { text: i18ns.t('balance.transactionType'), left: 'center' },
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'pie',
        radius: '60%',
        data: Object.entries(typeCount).map(([name, value]) => ({
          name: typeNameMap[name] || name,
          value,
        })),
      },
    ],
  }
})

const formatHourlyConsumptionTooltip = (
  params:
    | {
        axisValueLabel?: string
        seriesName?: string
        marker?: string
        value?: number | string
      }[]
    | {
        axisValueLabel?: string
        seriesName?: string
        marker?: string
        value?: number | string
      },
) => {
  const items = Array.isArray(params) ? params : [params]
  if (items.length === 0) return ''

  const hourLabel = items[0]?.axisValueLabel || ''
  const visibleItems = items.filter((item) => Number(item.value || 0) > 0)

  if (visibleItems.length === 0) return hourLabel

  return [
    hourLabel,
    ...visibleItems.map(
      (item) =>
        `${item.marker || ''}${item.seriesName || ''}: ${Number(Number(item.value || 0).toFixed(2))}${i18ns.t('balance.yuan')}`,
    ),
  ].join('<br/>')
}

const hourlyConsumptionChartOption = computed(() => {
  const now = new Date()
  const hourlyData: { hour: string; timestamp: number; models: Record<string, number> }[] = []
  for (let i = 23; i >= 0; i--) {
    const hour = new Date(now.getTime() - i * 60 * 60 * 1000)
    const hourTimestamp = Math.floor(hour.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000
    hourlyData.push({
      hour: `${String(hour.getHours()).padStart(2, '0')}:00`,
      timestamp: hourTimestamp,
      models: {},
    })
  }
  const recentTx = filteredTransactions.value.filter((t) => {
    const txTime = new Date(t.createTime).getTime()
    return txTime >= now.getTime() - 24 * 60 * 60 * 1000 && isChargeableApiUsageRecord(t)
  })
  recentTx.forEach((t) => {
    const txTime = new Date(t.createTime)
    const txHourTimestamp = Math.floor(txTime.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000
    const hourData = hourlyData.find((h) => h.timestamp === txHourTimestamp)
    const modelName = getModelDisplay(t)
    if (hourData && modelName) {
      hourData.models[modelName] = (hourData.models[modelName] || 0) + Math.abs(Number(t.amount))
    }
  })
  const allModels = new Set<string>()
  hourlyData.forEach((h) => Object.keys(h.models).forEach((m) => allModels.add(m)))
  const modelList = Array.from(allModels).slice(0, 10)
  const colors = [
    '#409eff',
    '#67c23a',
    '#e6a23c',
    '#f56c6c',
    '#909399',
    '#00c0ef',
    '#ff6b6b',
    '#4ecdc4',
    '#45b7d1',
    '#96ceb4',
  ]
  const series = modelList.map((model, i) => ({
    name: model,
    type: 'bar',
    stack: 'consumption',
    data: hourlyData.map((h) => Number((h.models[model] || 0).toFixed(2))),
    itemStyle: { color: colors[i % colors.length] },
  }))
  return {
    title: { text: i18ns.t('balance.hourlyConsumptionByModel'), left: 'center' },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: formatHourlyConsumptionTooltip,
    },
    legend: { type: 'scroll', bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
    xAxis: { type: 'category', data: hourlyData.map((h) => h.hour), axisLabel: { rotate: 45 } },
    yAxis: { type: 'value', axisLabel: { formatter: `{value}${i18ns.t('balance.yuan')}` } },
    series,
  }
})

const modelChartOption = computed(() => {
  const modelCount: Record<string, number> = {}
  filteredTransactions.value
    .filter((t) => isChargeableApiUsageRecord(t) && getModelDisplay(t))
    .forEach((t) => {
      const modelName = getModelDisplay(t)
      modelCount[modelName] = (modelCount[modelName] || 0) + 1
    })
  const sortedModels = Object.entries(modelCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  return {
    title: { text: i18ns.t('balance.modelUsageDistribution'), left: 'center' },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: sortedModels.map(([name]) => name),
      axisLabel: { rotate: 45 },
    },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: sortedModels.map(([, count]) => count) }],
  }
})

const tokenUsageChartOption = computed(() => {
  const apiUsageTransactions = filteredTransactions.value
    .filter((t) => isChargeableApiUsageRecord(t))
    .sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime())

  const hourlyTokens = new Map<
    string,
    { input: number; output: number; cacheCreation: number; cacheRead: number }
  >()
  apiUsageTransactions.forEach((t) => {
    const date = new Date(t.createTime)
    const hourKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`
    const existing = hourlyTokens.get(hourKey) || {
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0,
    }
    existing.input += t.inputTokens || 0
    existing.output += t.outputTokens || 0
    existing.cacheCreation += t.cacheCreationTokens || 0
    existing.cacheRead += t.cacheReadTokens || 0
    hourlyTokens.set(hourKey, existing)
  })

  const sortedHours = Array.from(hourlyTokens.keys()).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime(),
  )

  return {
    title: { text: i18ns.t('balance.dailyTokenUsage'), left: 'center' },
    tooltip: { trigger: 'axis' },
    legend: {
      data: [
        i18ns.t('balance.inputTokens'),
        i18ns.t('balance.outputTokens'),
        i18ns.t('balance.cacheCreationTokens'),
        i18ns.t('balance.cacheReadTokens'),
      ],
      top: 30,
    },
    xAxis: { type: 'category', data: sortedHours, axisLabel: { rotate: 45 } },
    yAxis: { type: 'value', name: i18ns.t('ServerConfigView.tokens') },
    series: [
      {
        name: i18ns.t('balance.inputTokens'),
        type: 'bar',
        stack: 'total',
        data: sortedHours.map((h) => hourlyTokens.get(h)?.input || 0),
      },
      {
        name: i18ns.t('balance.outputTokens'),
        type: 'bar',
        stack: 'total',
        data: sortedHours.map((h) => hourlyTokens.get(h)?.output || 0),
      },
      {
        name: i18ns.t('balance.cacheCreationTokens'),
        type: 'bar',
        stack: 'total',
        data: sortedHours.map((h) => hourlyTokens.get(h)?.cacheCreation || 0),
      },
      {
        name: i18ns.t('balance.cacheReadTokens'),
        type: 'bar',
        stack: 'total',
        data: sortedHours.map((h) => hourlyTokens.get(h)?.cacheRead || 0),
      },
    ],
  }
})

const dailyBalanceChangeChartOption = computed(() => {
  const dailyData = new Map<string, { recharge: number; usage: number; balance: number }>()
  const sortedTx = [...filteredTransactions.value].sort(
    (a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime(),
  )

  sortedTx.forEach((t) => {
    const date = new Date(t.createTime).toLocaleDateString()
    const existing = dailyData.get(date) || {
      recharge: 0,
      usage: 0,
      balance: Number(t.balanceAfter),
    }
    const category = getTransactionCategory(t)
    if (category === 'redemption' || category === 'recharge') {
      existing.recharge += Number(t.amount)
    } else if (category === 'api_usage' || category === 'chat_usage') {
      existing.usage += Math.abs(Number(t.amount))
    }
    existing.balance = Number(t.balanceAfter)
    dailyData.set(date, existing)
  })

  const dates = Array.from(dailyData.keys())
  return {
    title: { text: i18ns.t('balance.dailyBalanceChange'), left: 'center' },
    tooltip: { trigger: 'axis' },
    legend: {
      data: [
        i18ns.t('balance.recharge'),
        i18ns.t('balance.usage'),
        i18ns.t('relay.accountBalance'),
      ],
      top: 30,
    },
    xAxis: { type: 'category', data: dates, axisLabel: { rotate: 45 } },
    yAxis: { type: 'value' },
    series: [
      {
        name: i18ns.t('balance.recharge'),
        type: 'bar',
        data: dates.map((d) => Number((dailyData.get(d)?.recharge || 0).toFixed(2))),
      },
      {
        name: i18ns.t('balance.usage'),
        type: 'bar',
        data: dates.map((d) => Number((dailyData.get(d)?.usage || 0).toFixed(2))),
      },
      {
        name: i18ns.t('relay.accountBalance'),
        type: 'line',
        data: dates.map((d) => Number((dailyData.get(d)?.balance || 0).toFixed(2))),
      },
    ],
  }
})
</script>

<style scoped>
.text-placeholder {
  color: var(--el-text-color-placeholder);
}
.filter-section {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 16px;
}

.range-action-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.range-slider-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 360px;
  min-width: 260px;
  flex-wrap: wrap;
}

.range-slider-group__control {
  flex: 1 1 320px;
  min-width: 220px;
  padding: 0 6px;
}

.range-action-group__label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.range-action-group__hint {
  font-size: 12px;
  color: var(--el-color-success);
  white-space: nowrap;
}

.zero-charge-hint {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding: 10px 14px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--el-color-warning) 32%, transparent);
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--el-color-warning-light-9) 86%, white),
      transparent
    ),
    var(--el-fill-color-lighter);
  color: var(--el-text-color-regular);
}

.zero-charge-hint__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--el-color-warning);
  color: white;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.zero-charge-hint__text {
  font-size: 13px;
  line-height: 1.5;
}

.amount-positive {
  color: #67c23a;
  font-weight: 600;
  white-space: nowrap;
}

.amount-negative {
  color: #f56c6c;
  font-weight: 600;
  white-space: nowrap;
}

.amount-covered {
  color: var(--el-color-primary);
  font-weight: 600;
  white-space: nowrap;
  cursor: help;
}

.amount-zero-charge {
  color: var(--el-color-primary);
  font-weight: 600;
  white-space: nowrap;
  cursor: help;
}

.expand-content {
  padding: 16px 50px;
  background: var(--el-fill-color-lighter);
  transform-origin: top center;
  will-change: opacity, transform, max-height;
}

.expand-section {
  padding: 12px;
  background: var(--el-bg-color);
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--el-border-color-lighter) 82%, transparent);
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
}

.transaction-expand-enter-active,
.transaction-expand-leave-active {
  overflow: hidden;
  transition:
    opacity 0.24s ease,
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    max-height 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    filter 0.24s ease;
}

.transaction-expand-enter-from,
.transaction-expand-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.985);
  max-height: 0;
  filter: blur(4px);
}

.transaction-expand-enter-to,
.transaction-expand-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
  max-height: 720px;
  filter: blur(0);
}

.calc-formula {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-family: monospace;
  color: var(--el-color-primary);
  border-left: 3px solid var(--el-color-primary);
}

.timing-metrics {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  height: 100%;
  flex-wrap: wrap;
}

.metric-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.metric-label {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  min-width: 45px;
}

.metric-value {
  color: var(--el-color-primary);
  font-weight: 600;
  font-family: monospace;
}

.metric-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--el-fill-color);
  border: 1px solid var(--el-border-color-lighter);
}

.metric-badge__label {
  color: var(--el-text-color-secondary);
}

.metric-badge__value {
  color: var(--el-text-color-primary);
  font-weight: 600;
  font-family: monospace;
}

.stream-badge {
  display: inline-flex;
  align-items: center;
  align-self: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: 4px;
}

.stream-badge--yes {
  color: #67c23a;
  background: rgba(103, 194, 58, 0.1);
}

.stream-badge--no {
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
}

.stream-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stream-badge--yes .stream-dot {
  background: #67c23a;
}

.stream-badge--no .stream-dot {
  background: var(--el-text-color-placeholder);
}

.charts-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
  gap: 20px;
}

.chart-item {
  background: var(--el-bg-color);
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  min-width: 0;
}

.mobile-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mobile-billing-details {
  font-size: 13px;
}

.detail-collapse :deep(.el-collapse) {
  border-top: none;
  border-bottom: none;
}

.detail-collapse :deep(.el-collapse-item) {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--el-border-color-lighter) 78%, transparent);
  background: color-mix(in srgb, var(--el-fill-color-light) 55%, var(--el-bg-color));
}

.detail-collapse :deep(.el-collapse-item__header) {
  padding: 0 14px;
  font-weight: 600;
  background: transparent;
  transition:
    color 0.2s ease,
    padding-left 0.24s ease,
    background-color 0.24s ease;
}

.detail-collapse :deep(.el-collapse-item__header.is-active) {
  color: var(--el-color-primary);
  padding-left: 18px;
  background: color-mix(in srgb, var(--el-color-primary-light-9) 72%, transparent);
}

.detail-collapse :deep(.el-collapse-item__wrap) {
  transition:
    height 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.24s ease;
}

.detail-collapse :deep(.el-collapse-item__content) {
  padding: 4px 14px 14px;
}

.mobile-billing-details .detail-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.mobile-billing-details .detail-row:last-child {
  border-bottom: none;
}

.tx-card {
  border-radius: 8px;
}

.tx-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.tx-card-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tx-card-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  font-size: 13px;
}

.tx-label {
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
  margin-right: 8px;
}

.tx-value {
  text-align: right;
  word-break: break-all;
}

@media (max-width: 768px) {
  .charts-container {
    grid-template-columns: 1fr;
  }

  .chart-item {
    padding: 12px;
  }
}
</style>
