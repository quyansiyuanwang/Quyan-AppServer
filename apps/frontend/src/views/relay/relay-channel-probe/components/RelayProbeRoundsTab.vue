<template>
  <section class="probe-rounds">
    <header class="round-heading">
      <div>
        <h2>{{ i18ns.t('relay.probeDailySchedule') }}</h2>
        <p>{{ i18ns.t('relay.probeDailyScheduleHelp') }}</p>
      </div>
      <el-button @click="refresh">{{ i18ns.t('refresh') }}</el-button>
    </header>
    <el-alert v-if="error" type="error" :closable="false" :title="error" />
    <el-form label-position="top" class="schedule-form" :disabled="saving || !schedule">
      <el-form-item :label="i18ns.t('relay.probeDailyEnabled')"
        ><el-switch v-model="enabled" :disabled="!canExecute"
      /></el-form-item>
      <el-form-item :label="i18ns.t('relay.probeDailyTime')"
        ><el-time-select
          v-model="time"
          start="00:00"
          end="23:45"
          step="00:15"
          :clearable="false"
          :disabled="!canExecute"
      /></el-form-item>
      <el-form-item :label="i18ns.t('relay.probeDailyNext')"
        ><span>{{ schedule?.enabled ? date(schedule.nextRunAt) : '—' }}</span></el-form-item
      >
      <el-form-item v-if="canExecute"
        ><el-button type="primary" :loading="saving" @click="save">{{
          i18ns.t('save')
        }}</el-button></el-form-item
      >
    </el-form>
    <el-alert type="info" :closable="false" :title="i18ns.t('relay.probeDailySummaryHelp')" />
    <h3>{{ i18ns.t('relay.probeRoundHistory') }}</h3>
    <el-table :data="rounds" v-loading="loading" row-key="id">
      <el-table-column :label="i18ns.t('relay.probeDailyTime')" min-width="190"
        ><template #default="{ row }">{{ date(row.scheduledFor) }}</template></el-table-column
      >
      <el-table-column :label="i18ns.t('status')" min-width="120"
        ><template #default="{ row }">{{ stateLabel(row.state) }}</template></el-table-column
      >
      <el-table-column
        prop="targetCount"
        :label="i18ns.t('relay.probeRoundTargetCount')"
        width="110"
      />
      <el-table-column :label="i18ns.t('relay.probeRoundDelivery')" min-width="150"
        ><template #default="{ row }">{{
          stateLabel(row.notificationState)
        }}</template></el-table-column
      >
      <el-table-column :label="i18ns.t('actions')" width="110"
        ><template #default="{ row }"
          ><el-button link type="primary" @click="selectRound(row.id)">{{
            i18ns.t('relay.channelProbeManage')
          }}</el-button></template
        ></el-table-column
      >
    </el-table>
    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[20, 50, 100]"
      layout="total, prev, pager, next, sizes"
    />
    <section v-if="detail" v-loading="detailLoading" class="round-report">
      <h3>{{ i18ns.t('relay.probeRoundReport') }} · {{ date(detail.round.scheduledFor) }}</h3>
      <el-alert
        v-if="detail.round.errorCode"
        type="warning"
        :closable="false"
        :title="`${stageLabel(detail.round.errorStage)} · ${errorLabel(detail.round.errorCode)}`"
      />
      <el-empty v-if="!detail.items.length" :description="i18ns.t('relay.probeRoundNoTargets')" />
      <article v-for="target in detail.items" :key="target.id" class="target-report">
        <div class="target-heading">
          <strong
            >{{ target.channelName
            }}<template v-if="target.memberChannelName">
              / {{ target.memberChannelName }}</template
            ></strong
          ><el-tag :type="target.state === 'succeeded' ? 'success' : 'warning'">{{
            stateLabel(target.state)
          }}</el-tag>
        </div>
        <dl class="metrics">
          <div v-for="metric in metrics(target)" :key="metric.label">
            <dt>{{ metric.label }}</dt>
            <dd>{{ metric.value }}</dd>
          </div>
        </dl>
        <el-alert
          v-if="target.errorCode"
          type="warning"
          :closable="false"
          :title="`${stageLabel(target.errorStage)} · ${errorLabel(target.errorCode)}`"
        />
      </article>
      <el-pagination
        v-model:current-page="detailPage"
        v-model:page-size="detailSize"
        :total="detail.total"
        :page-sizes="[20, 50, 100]"
        layout="total, prev, pager, next, sizes"
      />
    </section>
  </section>
</template>

<script setup lang="ts">
import { toRef } from 'vue'
import { i18ns, type I18nENAvailableKeys } from '@/locales'
import { useProbeRounds } from '../useProbeRounds'
import type { RelayProbeRoundTargetReportDto } from '@/client/types.gen'
const props = defineProps<{ active: boolean; canExecute: boolean }>()
const {
  schedule,
  enabled,
  time,
  saving,
  loading,
  detailLoading,
  error,
  rounds,
  total,
  page,
  pageSize,
  detail,
  detailPage,
  detailSize,
  selectRound,
  save,
  refresh,
} = useProbeRounds(toRef(props, 'active'))
const date = (value: string | undefined) =>
  value ? new Date(value).toLocaleString(undefined, { timeZone: 'Asia/Shanghai' }) : '—'
const number = (value: number | undefined) =>
  value == null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value)
const stateLabel = (state?: string) =>
  state ? i18ns.t(`relay.probeRoundStates.${state}` as I18nENAvailableKeys) : '—'
const stageLabel = (stage?: string) =>
  stage ? i18ns.t(`relay.probeRoundStages.${stage}` as I18nENAvailableKeys) : '—'
const errorLabel = (code: string) =>
  code.startsWith('upstream-http-')
    ? `HTTP ${code.slice('upstream-http-'.length)}`
    : i18ns.t(`relay.probeRoundErrors.${code}` as I18nENAvailableKeys)
function metrics(target: RelayProbeRoundTargetReportDto) {
  return [
    {
      label: i18ns.t('relay.probeRoundBalance'),
      value: `${number(target.balanceBefore)} → ${number(target.balanceAfter)} ${target.upstreamCurrency ?? ''} (Δ ${number(target.balanceDelta)})`,
    },
    {
      label: i18ns.t('relay.probeRoundLocalBalance'),
      value: `${number(target.localBalanceBefore)} → ${number(target.localBalanceAfter)} ${target.localCurrency ?? ''} (Δ ${number(target.localBalanceDelta)})`,
    },
    {
      label: i18ns.t('relay.probeRoundUsage'),
      value: `${number(target.inputTokens)} / ${number(target.outputTokens)}`,
    },
    {
      label: i18ns.t('relay.probeRoundCache'),
      value: `${number(target.cacheReadTokens)} / ${number(target.cacheCreationTokens)}`,
    },
    {
      label: i18ns.t('relay.probeRoundCost'),
      value: `${number(target.baseLocalCost)} ${target.localCurrency ?? ''}`,
    },
    {
      label: i18ns.t('relay.probeRoundMultiplier'),
      value: `${number(target.measuredMultiplier)} → ${number(target.suggestedMultiplier)}`,
    },
    {
      label: i18ns.t('relay.probeRoundCurrentMultiplier'),
      value: number(target.currentMultiplier),
    },
    {
      label: i18ns.t('relay.probeRoundChange'),
      value: `${number(target.multiplierChange)} / ${number(target.multiplierChangePercent)}%`,
    },
    {
      label: i18ns.t('relay.probeRoundPrevious'),
      value: number(target.previousSuggestedMultiplier),
    },
    {
      label: i18ns.t('relay.probeRoundPreviousChange'),
      value: `${number(target.suggestionChange)} / ${number(target.suggestionChangePercent)}%`,
    },
    {
      label: i18ns.t('relay.probeRoundCalibration'),
      value: target.calibrationStatus
        ? i18ns.t(
            `relay.probeRoundCalibrationStates.${target.calibrationStatus}` as I18nENAvailableKeys,
          )
        : '—',
    },
  ]
}
</script>

<style scoped>
.probe-rounds {
  display: grid;
  gap: 20px;
}
.round-heading,
.target-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
h2,
h3,
p {
  margin: 0;
}
p {
  color: var(--el-text-color-secondary);
  margin-top: 8px;
  line-height: 1.6;
}
.schedule-form {
  display: flex;
  align-items: end;
  gap: 24px;
  flex-wrap: wrap;
  padding: 24px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
}
.round-report {
  display: grid;
  gap: 16px;
}
.target-report {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  padding: 20px;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 18px;
  margin: 20px 0;
}
dt {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}
dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
@media (max-width: 640px) {
  .schedule-form {
    padding: 16px;
    gap: 12px;
  }
  .target-report {
    padding: 16px;
  }
  .metrics {
    grid-template-columns: 1fr;
  }
  .target-heading {
    align-items: start;
  }
}
</style>
