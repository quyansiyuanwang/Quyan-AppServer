<template>
  <div class="agent-machines-page">
    <header class="page-header">
      <div>
        <h1>{{ i18ns.t('agentMachines.title') }}</h1>
        <p>{{ i18ns.t('agentMachines.subtitle') }}</p>
      </div>
      <el-button type="primary" :loading="loading" @click="openCreate">
        {{ i18ns.t('agentMachines.addMachine') }}
      </el-button>
      <el-button :disabled="!machines.length" @click="openWorkspace">
        {{ i18ns.t('agentMachines.addWorkspace') }}
      </el-button>
    </header>

    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" />
    <el-empty v-if="!loading && !machines.length" :description="i18ns.t('agentMachines.empty')" />
    <div v-else class="machine-grid">
      <el-card v-for="machine in machines" :key="machine.id" class="machine-card">
        <div class="machine-card__header">
          <div>
            <h2>{{ machine.name }}</h2>
            <span class="machine-runtime">{{ machine.runtime }}</span>
          </div>
          <el-tag :type="machine.runtimeStatus === 'online' ? 'success' : 'info'">
            {{ machine.runtimeStatus }}
          </el-tag>
        </div>
        <dl>
          <div>
            <dt>{{ i18ns.t('agentMachines.agentId') }}</dt>
            <dd>{{ machine.agentId || '-' }}</dd>
          </div>
          <div>
            <dt>{{ i18ns.t('agentMachines.lastHeartbeat') }}</dt>
            <dd>{{ formatDate(machine.lastHeartbeatAt) }}</dd>
          </div>
          <div>
            <dt>{{ i18ns.t('agentMachines.capabilities') }}</dt>
            <dd>{{ capabilityText(machine) }}</dd>
          </div>
        </dl>
        <el-button type="danger" text @click="removeMachine(machine.id)">{{
          i18ns.t('agentMachines.remove')
        }}</el-button>
      </el-card>
    </div>

    <section class="workspace-section">
      <h2>{{ i18ns.t('agentMachines.workspaces') }}</h2>
      <el-empty v-if="!workspaces.length" :description="i18ns.t('agentMachines.workspaceEmpty')" />
      <el-table v-else :data="workspaces">
        <el-table-column prop="name" :label="i18ns.t('agentMachines.workspaceName')" />
        <el-table-column :label="i18ns.t('agentMachines.boundMachine')">
          <template #default="{ row }">{{ row.machineName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="runtimeStatus" :label="i18ns.t('agentMachines.workspaceStatus')" />
      </el-table>
    </section>

    <el-dialog
      v-model="createVisible"
      :title="i18ns.t('agentMachines.addMachine')"
      width="520px"
      destroy-on-close
    >
      <el-form @submit.prevent="createMachine">
        <el-form-item :label="i18ns.t('agentMachines.name')">
          <el-input v-model="name" :placeholder="i18ns.t('agentMachines.namePlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="createMachine">{{
          i18ns.t('confirm')
        }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="workspaceVisible"
      :title="i18ns.t('agentMachines.addWorkspace')"
      width="520px"
      destroy-on-close
    >
      <el-form @submit.prevent="createWorkspace">
        <el-form-item :label="i18ns.t('agentMachines.workspaceName')">
          <el-input v-model="workspaceName" />
        </el-form-item>
        <el-form-item :label="i18ns.t('agentMachines.boundMachine')">
          <el-select v-model="workspaceMachineId" class="full-width">
            <el-option
              v-for="machine in machines"
              :key="machine.id"
              :label="machine.name"
              :value="machine.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="workspaceVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="createWorkspace">{{
          i18ns.t('confirm')
        }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="tokenVisible"
      :title="i18ns.t('agentMachines.tokenTitle')"
      width="680px"
      destroy-on-close
    >
      <el-alert
        type="warning"
        :title="i18ns.t('agentMachines.tokenWarning')"
        show-icon
        :closable="false"
      />
      <p class="token-label">{{ i18ns.t('agentMachines.tokenLabel') }}</p>
      <el-input :model-value="registrationToken" readonly>
        <template #append
          ><el-button @click="copyToken">{{ i18ns.t('agentMachines.copy') }}</el-button></template
        >
      </el-input>
      <p class="token-label">{{ i18ns.t('agentMachines.commandLabel') }}</p>
      <el-input :model-value="installCommand" type="textarea" :rows="4" readonly />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { i18ns } from '@/locales'
import { agentService } from '@/service/agentService'
import type { AgentMachine, AgentWorkspace } from '@/types/agent'

const machines = ref<AgentMachine[]>([])
const workspaces = ref<AgentWorkspace[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const createVisible = ref(false)
const tokenVisible = ref(false)
const name = ref('')
const workspaceVisible = ref(false)
const workspaceName = ref('')
const workspaceMachineId = ref('')
const registrationToken = ref('')
const installCommand = computed(
  () =>
    `APPSERVER_AGENT_ENDPOINT=wss://${window.location.host}/agent-runtime/ws\nAPPSERVER_AGENT_TOKEN=${registrationToken.value}\nAPPSERVER_AGENT_ID=<unique-machine-id>\npnpm --dir remote-agent start`,
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    ;[machines.value, workspaces.value] = await Promise.all([
      agentService.listMachines(),
      agentService.listWorkspaces(),
    ])
  } catch {
    error.value = i18ns.t('agentMachines.loadFailed')
  } finally {
    loading.value = false
  }
}
function openCreate() {
  name.value = ''
  createVisible.value = true
}
function openWorkspace() {
  workspaceName.value = ''
  workspaceMachineId.value = machines.value[0]?.id || ''
  workspaceVisible.value = true
}
async function createMachine() {
  if (!name.value.trim()) return
  saving.value = true
  try {
    const machine = await agentService.createMachine(name.value.trim())
    createVisible.value = false
    if (machine?.registrationToken) {
      registrationToken.value = machine.registrationToken
      tokenVisible.value = true
    }
    await load()
  } catch {
    error.value = i18ns.t('agentMachines.saveFailed')
  } finally {
    saving.value = false
  }
}
async function createWorkspace() {
  if (!workspaceName.value.trim() || !workspaceMachineId.value) return
  saving.value = true
  try {
    await agentService.createWorkspace(workspaceName.value.trim(), workspaceMachineId.value)
    workspaceVisible.value = false
    await load()
  } catch {
    error.value = i18ns.t('agentMachines.workspaceSaveFailed')
  } finally {
    saving.value = false
  }
}
async function removeMachine(id: string) {
  const ok = await ElMessageBox.confirm(
    i18ns.t('agentMachines.removeConfirm'),
    i18ns.t('warning'),
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false)
  if (!ok) return
  await agentService.deleteMachine(id)
  await load()
}
function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '-'
}
function capabilityText(machine: AgentMachine) {
  return (
    Object.entries(machine.capabilities || {})
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ') || '-'
  )
}
async function copyToken() {
  await navigator.clipboard.writeText(registrationToken.value)
  ElMessage.success(i18ns.t('agentMachines.copied'))
}
onMounted(load)
</script>

<style scoped>
.agent-machines-page {
  padding: 28px;
  max-width: 1100px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 24px;
}
.page-header h1 {
  margin: 0 0 8px;
}
.page-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
}
.machine-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
  margin-top: 20px;
}
.machine-card__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.machine-card h2 {
  margin: 0 0 4px;
  font-size: 18px;
}
.machine-runtime {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
dl {
  margin: 20px 0 8px;
  display: grid;
  gap: 10px;
}
dl div {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 8px;
}
dt {
  color: var(--el-text-color-secondary);
}
dd {
  margin: 0;
  word-break: break-word;
}
.token-label {
  margin: 18px 0 8px;
  font-weight: 600;
}
.workspace-section {
  margin-top: 36px;
}
.full-width {
  width: 100%;
}
@media (max-width: 640px) {
  .agent-machines-page {
    padding: 16px;
  }
  .page-header {
    flex-direction: column;
  }
}
</style>
