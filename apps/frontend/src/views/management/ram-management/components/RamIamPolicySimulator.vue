<template>
  <el-drawer
    v-model="iamSimulationVisible"
    :title="i18ns.t('RamManagement.simulatePolicy')"
    size="640px"
    @open="loadIamActions"
    @closed="resetIamSimulation"
  >
    <el-alert
      :title="i18ns.t('RamManagement.iamSimulationHint')"
      type="info"
      :closable="false"
      show-icon
    />
    <el-form :model="iamSimulationForm" label-position="top" class="simulation-form">
      <el-form-item :label="i18ns.t('RamManagement.iamPrincipalId')">
        <el-input v-model="iamSimulationForm.principalId" :disabled="iamSimulating" />
      </el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.iamAction')">
        <el-select
          v-model="iamSimulationForm.action"
          filterable
          :loading="iamActionsLoading"
          :disabled="iamSimulating || iamActionsLoading"
          style="width: 100%"
        >
          <el-option v-for="action in iamActions" :key="action" :value="action" :label="action" />
        </el-select>
      </el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.iamResource')">
        <el-input v-model="iamSimulationForm.resource" :disabled="iamSimulating" />
      </el-form-item>
    </el-form>
    <el-alert
      v-if="iamActionsFailed"
      :title="i18ns.t('RamManagement.iamActionsFailed')"
      type="error"
      :closable="false"
    />
    <el-button v-if="iamActionsFailed" :disabled="iamActionsLoading" @click="loadIamActions">
      {{ i18ns.t('RamManagement.reloadIamActions') }}
    </el-button>
    <el-alert
      v-if="iamSimulationFailed"
      :title="i18ns.t('RamManagement.iamSimulationFailed')"
      type="error"
      :closable="false"
    />
    <section v-if="iamSimulationResult" class="simulation-result" aria-live="polite">
      <el-tag :type="iamSimulationResult.decision === 'Allow' ? 'success' : 'danger'">{{
        iamSimulationResult.decision
      }}</el-tag>
      <p>{{ i18ns.t('RamManagement.iamDecisionReason') }}: {{ iamSimulationResult.reason }}</p>
      <p>{{ i18ns.t('RamManagement.iamMatches') }}</p>
      <ul>
        <li v-for="(match, index) in iamSimulationResult.matchedStatements" :key="index">
          {{ match.effect }} · {{ match.policyId }} · {{ match.versionId ?? '—' }} ·
          {{ match.statementId }}
        </li>
      </ul>
    </section>
    <template #footer>
      <el-button @click="iamSimulationVisible = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button
        type="primary"
        :loading="iamSimulating"
        :disabled="
          iamActionsLoading ||
          !iamSimulationForm.principalId.trim() ||
          !iamSimulationForm.action ||
          !iamSimulationForm.resource.trim()
        "
        @click="simulateIamPolicy"
        >{{ i18ns.t('RamManagement.simulatePolicy') }}</el-button
      >
    </template>
  </el-drawer>
</template>
<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'
const {
  iamActions,
  iamActionsLoading,
  iamActionsFailed,
  loadIamActions,
  iamSimulationVisible,
  iamSimulationForm,
  iamSimulationResult,
  iamSimulationFailed,
  iamSimulating,
  resetIamSimulation,
  simulateIamPolicy,
} = useRamManagementContext()
</script>
<style scoped>
.simulation-form {
  margin-top: 20px;
}
.simulation-result {
  margin-top: 20px;
  overflow-wrap: anywhere;
}
</style>
