<template>
  <main class="developer-admin-page">
    <header class="page-header">
      <div>
        <h1>开发者服务管理</h1>
        <p>按用户或项目覆盖验证码、IP 定位和推送服务的每日免费额度。</p>
      </div>
      <div class="page-actions">
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button :icon="Plus" type="primary" @click="openCreateDialog">新增额度覆盖</el-button>
      </div>
    </header>

    <el-alert class="scope-note" type="info" :closable="false" show-icon>
      覆盖额度优先级：项目服务级、项目全服务、用户服务级、用户全服务，最后才使用项目默认额度。
    </el-alert>

    <section class="table-surface" v-loading="loading">
      <el-table :data="overrides" row-key="id" empty-text="暂无额度覆盖规则">
        <el-table-column label="对象" min-width="270">
          <template #default="{ row }">
            <el-tag size="small" :type="row.subjectType === 'project' ? 'success' : 'info'">
              {{ row.subjectType === 'project' ? '项目' : '用户' }}
            </el-tag>
            <code class="subject-id">{{ row.subjectId }}</code>
          </template>
        </el-table-column>
        <el-table-column label="服务" width="140">
          <template #default="{ row }">{{ serviceLabel(row.service) }}</template>
        </el-table-column>
        <el-table-column prop="dailyFreeQuota" label="每日免费额度" width="150" />
        <el-table-column label="失效时间" min-width="180">
          <template #default="{ row }">{{ formatDate(row.expiresAt) }}</template>
        </el-table-column>
        <el-table-column label="更新时间" min-width="180">
          <template #default="{ row }">{{ formatDate(row.updateTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="132" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button link type="danger" @click="removeOverride(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑额度覆盖' : '新增额度覆盖'" width="min(520px, calc(100vw - 32px))">
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item label="对象类型" required>
          <el-segmented v-model="form.subjectType" :options="subjectTypeOptions" block />
        </el-form-item>
        <el-form-item :label="form.subjectType === 'project' ? '项目 ID' : '用户 ID'" required>
          <el-input v-model.trim="form.subjectId" placeholder="输入 CUID" :disabled="Boolean(editingId)" />
        </el-form-item>
        <el-form-item label="服务范围">
          <el-select v-model="form.service" class="full-width">
            <el-option label="全部开发者 API" value="all" />
            <el-option label="验证码" value="verification" />
            <el-option label="IP 定位" value="ip" />
            <el-option label="推送投递" value="push" />
          </el-select>
        </el-form-item>
        <el-form-item label="每日免费额度" required>
          <el-input-number v-model="form.dailyFreeQuota" :min="0" :max="10000000" class="full-width" />
        </el-form-item>
        <el-form-item label="失效时间">
          <el-date-picker
            v-model="form.expiresAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
            placeholder="留空表示永久有效"
            clearable
            class="full-width"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import type { DeveloperQuotaOverrideDto, UpsertDeveloperQuotaOverrideDto } from '@/client/types.gen'
import { developerQuotaAdminService } from '@/service/developerQuotaAdminService'

const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const editingId = ref('')
const overrides = ref<DeveloperQuotaOverrideDto[]>([])
const form = ref({
  subjectType: 'project' as 'project' | 'user',
  subjectId: '',
  service: 'all',
  dailyFreeQuota: 100,
  expiresAt: '',
})

const subjectTypeOptions = [
  { label: '项目', value: 'project' },
  { label: '用户', value: 'user' },
]

const serviceLabel = (service?: string) =>
  ({ verification: '验证码', ip: 'IP 定位', push: '推送投递' })[service ?? ''] ?? '全部服务'

const formatDate = (value?: string) => (value ? new Date(value).toLocaleString() : '永久有效')

const resetForm = () => {
  editingId.value = ''
  form.value = {
    subjectType: 'project',
    subjectId: '',
    service: 'all',
    dailyFreeQuota: 100,
    expiresAt: '',
  }
}

const load = async () => {
  loading.value = true
  try {
    overrides.value = await developerQuotaAdminService.list()
  } catch (error: any) {
    ElMessage.error(error?.message || '开发者额度规则加载失败')
  } finally {
    loading.value = false
  }
}

const openCreateDialog = () => {
  resetForm()
  dialogVisible.value = true
}

const openEditDialog = (override: DeveloperQuotaOverrideDto) => {
  editingId.value = override.id
  form.value = {
    subjectType: override.subjectType,
    subjectId: override.subjectId,
    service: override.service ?? 'all',
    dailyFreeQuota: override.dailyFreeQuota,
    expiresAt: override.expiresAt ?? '',
  }
  dialogVisible.value = true
}

const save = async () => {
  if (!form.value.subjectId) {
    ElMessage.warning('请输入用户或项目 ID')
    return
  }

  saving.value = true
  try {
    const payload: UpsertDeveloperQuotaOverrideDto = {
      subjectType: form.value.subjectType,
      subjectId: form.value.subjectId,
      dailyFreeQuota: form.value.dailyFreeQuota,
      ...(form.value.service !== 'all'
        ? { service: form.value.service as UpsertDeveloperQuotaOverrideDto['service'] }
        : {}),
      ...(form.value.expiresAt ? { expiresAt: form.value.expiresAt } : {}),
    }
    await developerQuotaAdminService.upsert(payload)
    ElMessage.success('额度覆盖已保存')
    dialogVisible.value = false
    await load()
  } catch (error: any) {
    ElMessage.error(error?.message || '额度覆盖保存失败')
  } finally {
    saving.value = false
  }
}

const removeOverride = async (override: DeveloperQuotaOverrideDto) => {
  try {
    await ElMessageBox.confirm(`删除 ${override.subjectId} 的额度覆盖？`, '删除额度覆盖', {
      type: 'warning',
    })
    await developerQuotaAdminService.remove(override.id)
    ElMessage.success('额度覆盖已删除')
    await load()
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error?.message || '额度覆盖删除失败')
  }
}

onMounted(() => void load())
</script>

<style scoped>
.developer-admin-page,
.developer-config-page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.page-header h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.page-header p {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
}
.page-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}
.scope-note {
  margin-bottom: 16px;
}
.table-surface {
  min-height: 260px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}
.subject-id {
  display: inline-block;
  max-width: 210px;
  margin-left: 8px;
  overflow: hidden;
  vertical-align: middle;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.full-width {
  width: 100%;
}
@media (max-width: 640px) {
  .developer-admin-page,
  .developer-config-page {
    padding: 16px;
  }
  .page-header {
    display: block;
  }
  .page-actions {
    margin-top: 16px;
  }
}
</style>
