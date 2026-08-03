<template>
  <el-dialog
    v-model="changeDialogOpen"
    :title="i18ns.t('relay.channelProbeChangeAnalysis')"
    width="min(1420px, 96vw)"
    append-to-body
  >
    <div class="change-analysis-toolbar">
      <el-select v-model="changeSort">
        <el-option value="largest" :label="i18ns.t('relay.channelProbeChangeLargest')" />
        <el-option value="smallest" :label="i18ns.t('relay.channelProbeChangeSmallest')" />
        <el-option value="recent" :label="i18ns.t('relay.channelProbeChangeRecent')" />
      </el-select>
      <el-select v-model="changeDirection">
        <el-option value="all" :label="i18ns.t('relay.channelProbeSelectionAll')" />
        <el-option value="increase" :label="i18ns.t('relay.channelProbeSelectionIncrease')" />
        <el-option value="decrease" :label="i18ns.t('relay.channelProbeSelectionDecrease')" />
      </el-select>
      <el-select v-model="changeTypeFilter">
        <el-option value="all" :label="i18ns.t('relay.channelProbeChangeTypeAll')" />
        <el-option value="suggested" :label="i18ns.t('relay.channelProbeChangeTypeSuggested')" />
        <el-option value="applied" :label="i18ns.t('relay.channelProbeChangeTypeApplied')" />
      </el-select>
      <span>{{ i18ns.t('relay.channelProbeSelectionTolerance') }}</span>
      <el-input-number
        v-model="changeMinimumPercent"
        :min="0"
        :max="100000"
        :step="0.1"
        :precision="2"
      />
      <span>%</span>
      <span>{{ i18ns.t('relay.channelProbeNoticeRoundingMode') }}</span>
      <el-select v-model="changeDisplayRoundingMode" class="rounding-mode">
        <el-option value="nearest" :label="i18ns.t('relay.channelProbeRoundNearest')" />
        <el-option value="ceil" :label="i18ns.t('relay.channelProbeRoundUp')" />
      </el-select>
      <span>{{ i18ns.t('relay.channelProbeNoticeDecimals') }}</span>
      <el-input-number v-model="changeDisplayDigits" :min="0" :max="6" :step="1" :precision="0" />
      <span class="selected-draft-summary">{{
        i18ns.t('relay.channelProbeChangeCount', { count: multiplierChangeRows.length })
      }}</span>
      <span class="selected-draft-summary">{{
        i18ns.t('relay.channelProbeCustomerNoticeCount', {
          count: publicMultiplierChangeRows.length,
        })
      }}</span>
      <el-tooltip :disabled="publicMultiplierChangeRows.length > 0" placement="top">
        <template #content>{{ i18ns.t('relay.channelProbeExportChangeChartNoPublic') }}</template>
        <span>
          <el-button
            :icon="Download"
            plain
            :disabled="publicMultiplierChangeRows.length === 0"
            @click="exportMultiplierChangeChart"
            >{{ i18ns.t('relay.channelProbeExportChangeChart') }}</el-button
          >
        </span>
      </el-tooltip>
    </div>
    <el-table :data="pagedCustomerFacingMultiplierChangeRows" max-height="60vh" class="w-full">
      <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="150" />
      <el-table-column :label="i18ns.t('relay.channelProbeChangeType')" width="108">
        <template #default="{ row }">
          <el-tag size="small" :type="row.applied ? 'success' : 'warning'">{{
            row.applied
              ? i18ns.t('relay.channelProbeSuggestionApplied')
              : i18ns.t('relay.channelProbeSuggestion')
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeChangeBefore')" width="118" align="right">
        <template #default="{ row }">{{ row.sourceMultiplier }}x</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeChangeAfter')" width="118" align="right">
        <template #default="{ row }">{{ row.targetMultiplier }}x</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeMultiplierChange')" min-width="286">
        <template #default="{ row }">
          <div class="multiplier-change-cell">
            <span
              :class="
                row.change > 0
                  ? 'multiplier-change-up'
                  : row.change < 0
                    ? 'multiplier-change-down'
                    : ''
              "
              >{{
                formatChangeValue(row.change) + ' · ' + row.changePercent.toFixed(2) + '%'
              }}</span
            >
            <div
              class="multiplier-direction-bar"
              :aria-label="multiplierDirectionLabel(row.sourceMultiplier, row.targetMultiplier)"
              role="img"
            >
              <span class="multiplier-direction-label multiplier-direction-label-left">{{
                i18ns.t('relay.channelProbePriceDecrease')
              }}</span>
              <span class="multiplier-direction-label multiplier-direction-label-center">{{
                i18ns.t('relay.channelProbeCurrentMultiplier')
              }}</span>
              <span class="multiplier-direction-label multiplier-direction-label-right">{{
                i18ns.t('relay.channelProbePriceIncrease')
              }}</span>
              <span class="multiplier-direction-track" />
              <span class="multiplier-direction-zero" />
              <span
                class="multiplier-direction-fill"
                :class="multiplierDirectionClass(row.sourceMultiplier, row.targetMultiplier)"
                :style="
                  multiplierDirectionStyle(
                    row.sourceMultiplier,
                    row.targetMultiplier,
                    customerFacingDirectionMaximumPercent,
                  )
                "
              />
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeCostFactors')" width="148" align="right">
        <template #default="{ row }">{{ row.costFactors }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeTargetCost')" width="138" align="right">
        <template #default="{ row }">{{ formatNumber(row.targetCost) }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeChangeTime')" width="168">
        <template #default="{ row }">{{ formatDate(row.time) }}</template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="changePage"
      v-model:page-size="changePageSize"
      class="mt-4 justify-end"
      layout="total, sizes, prev, pager, next"
      :page-sizes="[20, 50, 100]"
      :total="publicMultiplierChangeRows.length"
    />
  </el-dialog>
</template>

<script setup lang="ts">
import { Download } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { useRelayChannelProbeManagementContext } from '../context'

const {
  changeDialogOpen,
  changeDirection,
  changeDisplayDigits,
  changeDisplayRoundingMode,
  changeMinimumPercent,
  changePage,
  changePageSize,
  changeSort,
  changeTypeFilter,
  customerFacingDirectionMaximumPercent,
  exportMultiplierChangeChart,
  formatChangeValue,
  formatDate,
  formatNumber,
  multiplierChangeRows,
  multiplierDirectionClass,
  multiplierDirectionLabel,
  multiplierDirectionStyle,
  pagedCustomerFacingMultiplierChangeRows,
  publicMultiplierChangeRows,
} = useRelayChannelProbeManagementContext()
</script>
