<template>
          <div class="runs-toolbar">
            <el-button :loading="runsLoading" @click="loadRuns">{{ i18ns.t('refresh') }}</el-button>
            <el-button
              v-if="canExecute"
              type="primary"
              :disabled="!selected?.profile"
              :loading="runningId === selected?.channelId"
              @click="selected && run(selected)"
              >{{ i18ns.t('relay.channelProbeRun') }}</el-button
            >
            <el-checkbox
              v-if="canExecute"
              v-model="forceWithoutCacheBuster"
              :disabled="runningId !== ''"
            >
              {{ i18ns.t('relay.channelProbeForceWithoutCacheBuster') }}
            </el-checkbox>
            <el-button
              v-if="canExecute && selected"
              type="warning"
              plain
              :loading="resettingChannelId === selected?.channelId"
              @click="selected && confirmResetRunState(selected)"
              >{{ i18ns.t('relay.channelProbeResetState') }}</el-button
            >
            <el-button
              v-if="canExecute"
              type="danger"
              plain
              :disabled="runs.length === 0"
              :loading="clearingHistoryScope === 'failed'"
              @click="confirmClearRunHistory('failed')"
              >{{ i18ns.t('relay.channelProbeClearFailures') }}</el-button
            >
            <el-button
              v-if="canExecute"
              type="danger"
              :disabled="runs.length === 0"
              :loading="clearingHistoryScope === 'all'"
              @click="confirmClearRunHistory('all')"
              >{{ i18ns.t('relay.channelProbeClearHistory') }}</el-button
            >
          </div>
          <el-empty
            v-if="!runsLoading && runs.length === 0"
            :description="i18ns.t('relay.channelProbeNoRuns')"
            :image-size="64"
          />
          <section v-for="runItem in runs" :key="runItem.id" class="run-card">
            <div class="run-title">
              <el-tag :type="statusType(runItem.status)">{{ statusLabel(runItem.status) }}</el-tag
              ><span>{{ formatDate(runItem.createTime) }}</span
              ><el-button
                v-if="canAdjust && isApplicable(runItem)"
                link
                type="success"
                @click="confirmApply([runItem.id])"
                >{{ i18ns.t('relay.channelProbeApply') }}</el-button
              >
            </div>
            <el-descriptions :column="2" border size="small"
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeBalanceBefore')">{{
                formatNumber(runItem.upstreamBalanceBefore)
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeBalanceAfter')">{{
                formatNumber(runItem.upstreamBalanceAfter)
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeUpstreamDelta')">{{
                formatNumber(runItem.upstreamBalanceDelta)
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeCalibration')">{{
                calibrationStatusLabel(runItem.calibrationStatus)
              }}</el-descriptions-item
              ><el-descriptions-item
                :label="i18ns.t('relay.channelProbeBalanceSettlementTolerance')"
                >{{ formatNumber(runItem.balanceSettlementTolerance) }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeBaseCost')">{{
                formatNumber(runItem.baseLocalCost)
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeEstimatedCurrentCharge')">{{
                formatNumber(estimatedCurrentCharge(runItem))
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeUpstreamRate')">{{
                formatNumber(runItem.upstreamRateMultiplier)
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeTokens')">{{
                runItem.totalTokens ?? '-'
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeCacheCreationTokens')">{{
                runItem.cacheCreationTokens ?? '-'
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeCacheReadTokens')">{{
                runItem.cacheReadTokens ?? '-'
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeCacheBuster')">{{
                runItem.cacheBustingEnabled
                  ? (runItem.cacheBusterId ?? i18ns.t('relay.channelProbeCacheBusterUnavailable'))
                  : i18ns.t('relay.channelProbeCacheBusterDisabled')
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeEndpoint')">{{
                probeEndpointLabel(runItem.probeEndpoint)
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeSampleSummary')">{{
                i18ns.t('relay.channelProbeSampleSummaryValue', {
                  total: runItem.sampleCount,
                  succeeded: runItem.sampleSucceededCount,
                  accepted: runItem.sampleAcceptedCount,
                  discarded: runItem.sampleDiscardedCount,
                })
              }}</el-descriptions-item
              ><el-descriptions-item
                :label="i18ns.t('relay.channelProbeStrictCalibrationValidation')"
                >{{
                  runItem.strictCalibrationValidation
                    ? i18ns.t('relay.channelProbeValidationEnabled')
                    : i18ns.t('relay.channelProbeValidationDisabled')
                }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeWarmup')">{{
                runItem.warmupRequestCount
                  ? i18ns.t('relay.channelProbeWarmupValue', {
                      count: runItem.warmupRequestCount,
                      creation: runItem.warmupCacheCreationTokens ?? 0,
                      read: runItem.warmupCacheReadTokens ?? 0,
                    })
                  : '-'
              }}</el-descriptions-item
              ><el-descriptions-item :label="i18ns.t('relay.channelProbeSuggestion')">{{
                runItem.suggestedMultiplier == null ? '-' : `${runItem.suggestedMultiplier}x`
              }}</el-descriptions-item></el-descriptions
            >
            <p v-if="runItem.suggestedMultiplier != null" class="formula">
              {{
                i18ns.t('relay.channelProbeFormula', {
                  delta: formatNumber(runItem.upstreamBalanceDelta),
                  upstreamRate: formatNumber(runItem.upstreamRateMultiplier),
                  distribution: runItem.distributionMultiplier,
                  base: formatNumber(runItem.baseLocalCost),
                  suggested: runItem.suggestedMultiplier,
                })
              }}
            </p>
            <p v-if="estimatedCurrentCharge(runItem) != null" class="formula">
              {{
                i18ns.t('relay.channelProbeEstimatedCurrentChargeFormula', {
                  base: formatNumber(runItem.baseLocalCost),
                  multiplier: formatNumber(currentChannelMultiplier(runItem)),
                  estimated: formatNumber(estimatedCurrentCharge(runItem)),
                })
              }}
            </p>
            <p v-if="baseCostFormula(runItem)" class="formula formula-detail">
              {{ baseCostFormula(runItem) }}
            </p>
            <el-collapse v-if="runItem.upstreamUsage" class="usage-details">
              <el-collapse-item :title="i18ns.t('relay.channelProbeRawUsage')" name="usage">
                <pre>{{ formatUsage(runItem.upstreamUsage) }}</pre>
              </el-collapse-item>
            </el-collapse>
            <el-collapse v-if="runItem.samples?.length" class="usage-details">
              <el-collapse-item :title="i18ns.t('relay.channelProbeSampleDetails')" name="samples">
                <el-table :data="runItem.samples" size="small" max-height="280">
                  <el-table-column
                    prop="index"
                    :label="i18ns.t('relay.channelProbeSampleIndex')"
                    width="72"
                  />
                  <el-table-column :label="i18ns.t('relay.channelProbeSampleStatus')" width="110">
                    <template #default="{ row }">
                      <el-tag
                        :type="
                          row.status === 'discarded'
                            ? 'warning'
                            : row.status === 'failed' || row.status === 'settlement_timeout'
                              ? 'danger'
                              : row.status === 'low_signal' || row.status === 'balance_unstable'
                                ? 'warning'
                                : 'success'
                        "
                        size="small"
                      >
                        {{ sampleStatusLabel(row.status) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column
                    :label="i18ns.t('relay.channelProbeUpstreamDelta')"
                    min-width="120"
                  >
                    <template #default="{ row }">{{
                      formatNumber(row.upstreamBalanceDelta)
                    }}</template>
                  </el-table-column>
                  <el-table-column :label="i18ns.t('relay.channelProbeBaseCost')" min-width="110">
                    <template #default="{ row }">{{ formatNumber(row.baseLocalCost) }}</template>
                  </el-table-column>
                  <el-table-column :label="i18ns.t('relay.channelProbeSuggestion')" min-width="115">
                    <template #default="{ row }">{{
                      row.suggestedMultiplier == null ? '-' : `${row.suggestedMultiplier}x`
                    }}</template>
                  </el-table-column>
                  <el-table-column
                    prop="errorMessage"
                    :label="i18ns.t('relay.channelProbeSampleNote')"
                    min-width="210"
                    show-overflow-tooltip
                  />
                </el-table>
              </el-collapse-item>
            </el-collapse>
            <el-alert
              v-else-if="suggestionUnavailableReason(runItem)"
              type="warning"
              :closable="false"
              :title="suggestionUnavailableReason(runItem)"
              class="mt-2"
            />
            <el-alert
              v-if="runItem.errorMessage"
              type="error"
              :closable="false"
              :title="formatProbeError(runItem.errorMessage)"
              class="mt-2"
            />
          </section>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRelayChannelProbeManagementContext } from '../context'

const { baseCostFormula, calibrationStatusLabel, canAdjust, canExecute, clearingHistoryScope, confirmApply, confirmClearRunHistory, confirmResetRunState, currentChannelMultiplier, estimatedCurrentCharge, forceWithoutCacheBuster, formatDate, formatNumber, formatProbeError, formatUsage, isApplicable, loadRuns, probeEndpointLabel, resettingChannelId, run, runs, runsLoading, runningId, sampleStatusLabel, selected, statusLabel, statusType, suggestionUnavailableReason } = useRelayChannelProbeManagementContext()
</script>

