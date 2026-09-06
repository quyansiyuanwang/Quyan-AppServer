<template>
  <div class="system-oauth-management-view page-shell desktop-page">
    <el-card class="page-card">
      <template #header>
        <div class="card-header toolbar-row">
          <span>系统级 OAuth 客户端管理</span>
          <el-button type="primary" @click="showCreateDialog = true">
            <el-icon><Plus /></el-icon>
            创建系统客户端
          </el-button>
        </div>
      </template>

      <el-alert type="info" :closable="false" style="margin-bottom: 16px">
        <template #title>
          系统级 OAuth 客户端由超级管理员创建和管理，用于官方应用（如 CLI、Desktop）。
        </template>
      </el-alert>

      <el-table :data="systemClients" v-loading="loading">
        <el-table-column prop="clientId" label="Client ID" min-width="150">
          <template #default="{ row }">
            <code>{{ row.clientId }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column prop="clientType" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ row.clientType }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reviewStatus" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.reviewStatus === 'approved' ? 'success' : 'warning'" size="small">
              {{ row.reviewStatus }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="isPkceRequired" label="PKCE" width="80">
          <template #default="{ row }">
            <el-icon v-if="row.isPkceRequired" color="green"><Check /></el-icon>
            <el-icon v-else color="gray"><Close /></el-icon>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="viewClient(row)"> 查看 </el-button>
            <el-button link type="primary" size="small" @click="editClient(row)"> 编辑 </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 创建对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      title="创建系统级 OAuth 客户端"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-width="120px">
        <el-form-item label="Client ID" prop="clientId">
          <el-input v-model="form.clientId" placeholder="例如: quyan-cli" :disabled="isEditing" />
          <div class="form-tip">创建后不可修改</div>
        </el-form-item>

        <el-form-item label="应用名称" prop="name">
          <el-input v-model="form.name" placeholder="例如: Quyan CLI" />
        </el-form-item>

        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="官方命令行工具"
          />
        </el-form-item>

        <el-form-item label="客户端类型" prop="clientType">
          <el-select v-model="form.clientType" :disabled="isEditing">
            <el-option label="Public（公共客户端）" value="public" />
            <el-option label="Confidential（机密客户端）" value="confidential" />
          </el-select>
          <div class="form-tip">CLI/Desktop 使用 public，服务端应用使用 confidential</div>
        </el-form-item>

        <el-form-item label="回调地址" prop="redirectUris">
          <el-select
            v-model="form.redirectUris"
            multiple
            allow-create
            filterable
            default-first-option
            placeholder="输入回调 URL 后按回车"
            style="width: 100%"
          >
          </el-select>
          <div class="form-tip">例如: http://127.0.0.1:40016/callback</div>
        </el-form-item>

        <el-form-item label="权限范围" prop="scopes">
          <el-select
            v-model="form.scopes"
            multiple
            filterable
            placeholder="选择权限范围"
            style="width: 100%"
          >
            <el-option value="profile" label="profile - 用户基本信息" />
            <el-option value="relay:token:read" label="relay:token:read - 读取中继令牌" />
            <el-option value="relay:token:create" label="relay:token:create - 创建中继令牌" />
            <el-option value="relay:token:update" label="relay:token:update - 更新中继令牌" />
            <el-option value="relay:token:delete" label="relay:token:delete - 删除中继令牌" />
            <el-option value="relay:channel:read" label="relay:channel:read - 读取中继渠道" />
            <el-option value="relay:usage:read" label="relay:usage:read - 读取使用情况" />
            <el-option value="balance:read" label="balance:read - 读取余额" />
          </el-select>
        </el-form-item>

        <el-form-item label="PKCE" prop="isPkceRequired">
          <el-switch v-model="form.isPkceRequired" :disabled="isEditing" />
          <div class="form-tip">公共客户端（如 CLI）应启用 PKCE</div>
        </el-form-item>

        <el-form-item label="访问令牌有效期">
          <el-input-number v-model="form.accessTokenLifetime" :min="300" :max="86400" />
          <span style="margin-left: 8px">秒（默认 3600 = 1小时）</span>
        </el-form-item>

        <el-form-item label="刷新令牌有效期">
          <el-input-number v-model="form.refreshTokenLifetime" :min="3600" :max="2592000" />
          <span style="margin-left: 8px">秒（默认 604800 = 7天）</span>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          {{ isEditing ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 查看对话框 -->
    <el-dialog v-model="showViewDialog" title="系统客户端详情" width="600px">
      <el-descriptions :column="1" border v-if="selectedClient">
        <el-descriptions-item label="Client ID">
          <code>{{ selectedClient.clientId }}</code>
        </el-descriptions-item>
        <el-descriptions-item label="名称">{{ selectedClient.name }}</el-descriptions-item>
        <el-descriptions-item label="描述">{{ selectedClient.description }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ selectedClient.clientType }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="selectedClient.reviewStatus === 'approved' ? 'success' : 'warning'">
            {{ selectedClient.reviewStatus }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="PKCE">
          {{ selectedClient.isPkceRequired ? '启用' : '禁用' }}
        </el-descriptions-item>
        <el-descriptions-item label="回调地址">
          <div v-for="uri in parseJsonArray(selectedClient.redirectUris)" :key="uri">
            <code>{{ uri }}</code>
          </div>
        </el-descriptions-item>
        <el-descriptions-item label="权限范围">
          <el-tag
            v-for="scope in parseJsonArray(selectedClient.scopes)"
            :key="scope"
            size="small"
            style="margin: 2px"
          >
            {{ scope }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="系统客户端">
          <el-icon v-if="(selectedClient as any).isSystemClient" color="green"><Check /></el-icon>
          <el-icon v-else color="gray"><Close /></el-icon>
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Check, Close } from '@element-plus/icons-vue'
import { OAuthClientService } from '@/service/oauthClientService'
import type { OAuthClientDto } from '@/client/types.gen'

const oauthClientService = OAuthClientService.getInstance()

const loading = ref(false)
const submitting = ref(false)
const showCreateDialog = ref(false)
const showViewDialog = ref(false)
const isEditing = ref(false)
const systemClients = ref<OAuthClientDto[]>([])
const selectedClient = ref<OAuthClientDto | null>(null)
const formRef = ref()

const form = reactive({
  clientId: '',
  name: '',
  description: '',
  clientType: 'public' as 'public' | 'confidential',
  redirectUris: [] as string[],
  scopes: [] as string[],
  isPkceRequired: true,
  accessTokenLifetime: 3600,
  refreshTokenLifetime: 604800,
})

const rules = {
  clientId: [{ required: true, message: '请输入 Client ID', trigger: 'blur' }],
  name: [{ required: true, message: '请输入应用名称', trigger: 'blur' }],
  clientType: [{ required: true, message: '请选择客户端类型', trigger: 'change' }],
  redirectUris: [{ required: true, message: '请添加至少一个回调地址', trigger: 'change' }],
  scopes: [{ required: true, message: '请选择至少一个权限范围', trigger: 'change' }],
}

async function loadSystemClients() {
  loading.value = true
  try {
    const response = await oauthClientService.listSystemClients()
    systemClients.value = response.data.items || []
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function handleSubmit() {
  await formRef.value.validate()
  submitting.value = true
  try {
    const payload: any = {
      clientId: form.clientId,
      name: form.name,
      description: form.description,
      clientType: form.clientType,
      grantTypes: ['authorization_code', 'refresh_token'],
      redirectUris: form.redirectUris,
      scopes: form.scopes,
      isPkceRequired: form.isPkceRequired,
      accessTokenLifetime: form.accessTokenLifetime,
      refreshTokenLifetime: form.refreshTokenLifetime,
    }

    if (isEditing.value) {
      await oauthClientService.updateSystemClient(selectedClient.value!.id, payload)
      ElMessage.success('更新成功')
    } else {
      payload.isSystemClient = true // 仅创建时标记为系统客户端
      await oauthClientService.createSystemClient(payload)
      ElMessage.success('创建成功，状态已自动设置为"已批准"')
    }

    showCreateDialog.value = false
    await loadSystemClients()
  } catch (error: any) {
    ElMessage.error(error.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

function viewClient(client: OAuthClientDto) {
  selectedClient.value = client
  showViewDialog.value = true
}

function editClient(client: OAuthClientDto) {
  selectedClient.value = client
  isEditing.value = true
  Object.assign(form, {
    clientId: client.clientId,
    name: client.name,
    description: client.description,
    clientType: client.clientType,
    redirectUris: parseJsonArray(client.redirectUris),
    scopes: parseJsonArray(client.scopes),
    isPkceRequired: client.isPkceRequired,
    accessTokenLifetime: client.accessTokenLifetime,
    refreshTokenLifetime: client.refreshTokenLifetime,
  })
  showCreateDialog.value = true
}

function parseJsonArray(value: string | string[]): string[] {
  if (Array.isArray(value)) return value
  try {
    return JSON.parse(value as string)
  } catch {
    return []
  }
}

onMounted(() => {
  loadSystemClients()
})
</script>

<style scoped lang="scss">
.system-oauth-management-view {
  .toolbar-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .form-tip {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-top: 4px;
  }
}
</style>
