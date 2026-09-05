<template>
  <el-dialog
    v-model="applyDialogOpen"
    :title="i18ns.t('relay.channelProbeApplyDialogTitle')"
    width="min(1440px, calc(100vw - 32px))"
    class="probe-apply-dialog"
    append-to-body
    :close-on-click-modal="false"
  >
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      :title="i18ns.t('relay.channelProbeApplyDialogNotice')"
      class="mb-3"
    />
    <div class="calibration-toolbar">
      <span>{{ i18ns.t('relay.channelProbeRoundingMode') }}</span>
      <el-select v-model="roundingMode" class="rounding-mode">
        <el-option value="ceil" :label="i18ns.t('relay.channelProbeRoundUp')" />
        <el-option value="nearest" :label="i18ns.t('relay.channelProbeRoundNearest')" />
      </el-select>
      <span>{{ i18ns.t('relay.channelProbeRoundDigits') }}</span>
      <el-input-number v-model="roundingDigits" :min="0" :max="6" :step="1" :precision="0" />
      <span class="calibration-toolbar-divider" />
      <span>{{ i18ns.t('relay.channelProbeSelectionTolerance') }}</span>
      <el-input-number
        v-model="selectionTolerancePercent"
        :min="0"
        :max="100"
        :step="0.1"
        :precision="2"
      />
      <span>%</span>
      <el-select v-model="selectionDirection" class="selection-direction">
        <el-option value="all" :label="i18ns.t('relay.channelProbeSelectionAll')" />
        <el-option value="increase" :label="i18ns.t('relay.channelProbeSelectionIncrease')" />
        <el-option value="decrease" :label="i18ns.t('relay.channelProbeSelectionDecrease')" />
      </el-select>
      <el-button type="primary" plain @click="selectEligibleDrafts">{{
        i18ns.t('relay.channelProbeSelectEligible')
      }}</el-button>
      <el-button link @click="clearDraftSelection">{{
        i18ns.t('relay.channelProbeClearSelection')
      }}</el-button>
      <el-checkbox v-model="rememberApplySettings">{{
        i18ns.t('relay.channelProbeRememberApplySettings')
      }}</el-checkbox>
      <span class="selected-draft-summary">{{
        i18ns.t('relay.channelProbeSelected', { count: selectedApplyRunIds.length })
      }}</span>
    </div>
    <el-table
      ref="applyTableRef"
      :data="applyDrafts"
      row-key="run.id"
      max-height="440"
      class="w-full"
      @selection-change="onApplySelectionChange"
    >
      <el-table-column type="selection" width="46" reserve-selection />
      <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="140" />
      <el-table-column :label="i18ns.t('relay.channelProbeSourceMember')" min-width="140">
        <template #default="{ row }">{{ row.memberChannelName ?? '-' }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeCostFactors')" width="148" align="right">
        <template #default="{ row }">{{
          formatNumber(row.run.upstreamRateMultiplier) +
          ' × ' +
          formatNumber(row.run.distributionMultiplier)
        }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelMultiplier')" width="126" align="right">
        <template #default="{ row }">{{ row.currentMultiplier }}x</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeSuggestion')" width="132" align="right">
        <template #default="{ row }">{{ row.run.suggestedMultiplier }}x</template>
      </el-table-column>
      <el-table-column
        :label="i18ns.t('relay.channelProbeUpstreamDelta')"
        width="142"
        align="right"
      >
        <template #default="{ row }">{{ formatNumber(row.run.upstreamBalanceDelta) }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeTargetCost')" width="142" align="right">
        <template #default="{ row }">{{ formatNumber(targetLocalCost(row.run)) }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeBaseCost')" width="132" align="right">
        <template #default="{ row }">{{ formatNumber(row.run.baseLocalCost) }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeTargetMultiplier')" min-width="180">
        <template #default="{ row }">
          <el-input-number
            v-model="row.targetMultiplier"
            :min="0.000001"
            :max="1000"
            :step="0.000001"
            :precision="6"
            controls-position="right"
            class="w-full"
          />
        </template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeMultiplierChange')" min-width="238">
        <template #default="{ row }">
          <div class="multiplier-change-cell">
            <span :class="multiplierChangeClass(row)">{{
              formatMultiplierChange(row) + ' · ' + formatMultiplierChangePercent(row)
            }}</span>
            <div
              class="multiplier-direction-bar"
              :aria-label="multiplierDirectionLabel(row.currentMultiplier, row.targetMultiplier)"
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
                :class="multiplierDirectionClass(row.currentMultiplier, row.targetMultiplier)"
                :style="
                  multiplierDirectionStyle(
                    row.currentMultiplier,
                    row.targetMultiplier,
                    applyDirectionMaximumPercent,
                  )
                "
              />
            </div>
          </div>
        </template>
      </el-table-column>
    </el-table>
    <template #footer>
      <div class="apply-dialog-footer">
        <div class="apply-dialog-options">
          <el-checkbox
            v-if="hasLargeMultiplierChange"
            v-model="forceLargeMultiplierChange"
            :disabled="selectedApplyRunIds.length === 0"
            class="apply-dialog-option"
            >{{ i18ns.t('relay.channelProbeForceLargeChange') }}</el-checkbox
          >
          <el-checkbox
            v-model="exportAppliedChangeChart"
            :disabled="selectedApplyRunIds.length === 0"
            class="apply-dialog-option"
            >{{ i18ns.t('relay.channelProbeExportAppliedChangeChart') }}</el-checkbox
          >
        </div>
        <div class="apply-dialog-actions">
          <el-button @click="applyDialogOpen = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button
            type="primary"
            :disabled="selectedApplyRunIds.length === 0"
            :loading="applying"
            @click="submitApplyMultipliers"
            >{{
              i18ns.t('relay.channelProbeApplySelected', { count: selectedApplyRunIds.length })
            }}</el-button
          >
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRelayChannelProbeManagementContext } from '../context'

const {
  applyDialogOpen,
  applyDirectionMaximumPercent,
  applyDrafts,
  applyTableRef,
  applying,
  clearDraftSelection,
  exportAppliedChangeChart,
  forceLargeMultiplierChange,
  formatMultiplierChange,
  formatMultiplierChangePercent,
  formatNumber,
  hasLargeMultiplierChange,
  multiplierChangeClass,
  multiplierDirectionClass,
  multiplierDirectionLabel,
  multiplierDirectionStyle,
  onApplySelectionChange,
  rememberApplySettings,
  roundingDigits,
  roundingMode,
  selectEligibleDrafts,
  selectedApplyRunIds,
  selectionDirection,
  selectionTolerancePercent,
  submitApplyMultipliers,
  targetLocalCost,
} = useRelayChannelProbeManagementContext()
</script>
