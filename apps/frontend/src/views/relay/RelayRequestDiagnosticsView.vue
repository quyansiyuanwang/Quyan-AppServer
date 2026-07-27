<template>
  <main class="request-diagnostics-page">
    <header class="page-header">
      <div><h1>{{ i18ns.t('relay.requestDiagnostics') }}</h1><p>{{ i18ns.t('relay.requestDiagnosticsDescription') }}</p></div>
      <el-button :icon="Refresh" :loading="loading" @click="load">{{ i18ns.t('refresh') }}</el-button>
    </header>
    <el-alert v-if="error" type="error" :closable="false" show-icon>{{ error }}</el-alert>
    <section class="toolbar">
      <el-input v-model="filters.requestId" clearable :placeholder="i18ns.t('relay.requestIdSearch')" @keyup.enter="search" />
      <el-input v-model="filters.keyword" clearable :placeholder="i18ns.t('relay.requestDiagnosticsKeyword')" @keyup.enter="search" />
      <el-select v-model="filters.outcome" clearable :placeholder="i18ns.t('relay.requestOutcome')">
        <el-option value="success" :label="i18ns.t('relay.requestOutcomeSuccess')" /><el-option value="client-error" :label="i18ns.t('relay.requestOutcomeClientError')" /><el-option value="server-error" :label="i18ns.t('relay.requestOutcomeServerError')" />
      </el-select>
      <el-button type="primary" @click="search">{{ i18ns.t('search') }}</el-button>
    </section>
    <el-table v-loading="loading" :data="records" row-key="requestId" @row-click="open">
      <el-table-column prop="requestId" :label="i18ns.t('balance.requestId')" min-width="260"><template #default="{ row }"><code>{{ row.requestId }}</code></template></el-table-column>
      <el-table-column prop="username" :label="i18ns.t('relay.requestUser')" min-width="130" />
      <el-table-column prop="relayTokenName" :label="i18ns.t('balance.tokenName')" min-width="140" />
      <el-table-column :label="i18ns.t('relay.requestAttempts')" width="100" align="center"><template #default="{ row }">{{ row.attempts.length }}</template></el-table-column>
      <el-table-column :label="i18ns.t('relay.requestTime')" min-width="170"><template #default="{ row }">{{ formatTime(row.createTime) }}</template></el-table-column>
      <el-table-column :label="i18ns.t('relay.requestActions')" width="90"><template #default="{ row }"><el-button link type="primary" @click.stop="open(row)">{{ i18ns.t('relay.requestDetails') }}</el-button></template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" :total="total" :page-size="20" layout="total, prev, pager, next" @current-change="load" />
    <el-drawer v-model="drawer" :title="selected?.requestId" size="min(760px, 100vw)">
      <el-descriptions v-if="selected" :column="2" border><el-descriptions-item :label="i18ns.t('relay.requestUser')">{{ selected.username || '-' }}</el-descriptions-item><el-descriptions-item :label="i18ns.t('balance.tokenName')">{{ selected.relayTokenName || '-' }}</el-descriptions-item></el-descriptions>
      <el-table v-if="selected" :data="selected.attempts" class="attempts"><el-table-column prop="executionChannelName" :label="i18ns.t('relay.executionChannel')" min-width="160" /><el-table-column prop="statusCode" :label="i18ns.t('relay.requestStatusCode')" width="100" /><el-table-column prop="path" :label="i18ns.t('relay.requestPath')" min-width="200" /><el-table-column prop="totalTokens" :label="i18ns.t('balance.totalTokens')" width="110" /></el-table>
    </el-drawer>
  </main>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { relayTokenService } from '@/service/relayTokenService'
import { getErrorMessage } from '@/utils/error-utils'
const records = ref<any[]>([]); const total = ref(0); const page = ref(1); const loading = ref(false); const error = ref(''); const drawer = ref(false); const selected = ref<any>();
const filters = ref({ requestId: '', keyword: '', outcome: '' })
const formatTime = (value: string) => new Date(value).toLocaleString()
const open = (row: any) => { selected.value = row; drawer.value = true }
async function load() { loading.value = true; error.value = ''; try { const data: any = await relayTokenService.getRequestDiagnostics({ page: page.value, pageSize: 20, ...filters.value }); records.value = data.records || []; total.value = data.total || 0 } catch (cause) { error.value = getErrorMessage(cause, i18ns.t('relay.requestDiagnosticsLoadFailed')) } finally { loading.value = false } }
const search = () => { page.value = 1; void load() }
onMounted(load)
</script>
<style scoped>
.request-diagnostics-page { padding: 24px; min-width: 0; }.page-header { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; margin-bottom:20px; }.page-header h1 { margin:0; font-size:22px; }.page-header p { margin:6px 0 0; color:var(--el-text-color-secondary); }.toolbar { display:grid; grid-template-columns:minmax(240px,1.5fr) minmax(180px,1fr) 180px auto; gap:10px; margin:16px 0; }.attempts { margin-top:20px; } @media (max-width:760px) { .request-diagnostics-page { padding:16px; }.toolbar { grid-template-columns:1fr; }.page-header { align-items:center; }.page-header p { display:none; } }
</style>
