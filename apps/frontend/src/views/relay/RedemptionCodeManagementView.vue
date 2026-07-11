<template>
  <div v-if="isDesktop" class="desktop-page page-shell redemption-code-management">
    <el-card class="page-card">
      <template #header>
        <div class="card-header toolbar-row">
          <span>{{ i18ns.t('nav.redemptionCodes') }}</span>
          <el-button type="primary" @click="showCreateDialog = true">{{
            i18ns.t('redemption.create')
          }}</el-button>
        </div>
      </template>

      <div class="redemption-code-management__table-wrap">
        <el-table
          v-loading="loading"
          :data="codes"
          class="redemption-code-management__table"
          style="width: 100%"
        >
          <el-table-column
            prop="code"
            :label="i18ns.t('redemption.code')"
            min-width="220"
            class-name="redemption-code-management__code-column"
          >
            <template #default="{ row }">
              <el-link
                type="primary"
                class="redemption-code-management__code-link"
                @click="copyCode(row.code)"
              >
                {{ row.code }}
              </el-link>
            </template>
          </el-table-column>
          <el-table-column prop="amount" :label="i18ns.t('redemption.amount')" width="120" />
          <el-table-column :label="i18ns.t('relay.statusCode')" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.usedBy" type="info">{{ i18ns.t('redemption.used') }}</el-tag>
              <el-tag
                v-else-if="row.expiresAt && new Date(row.expiresAt) < new Date()"
                type="danger"
                >{{ i18ns.t('redemption.expired') }}</el-tag
              >
              <el-tag v-else type="success">{{ i18ns.t('redemption.unused') }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="usedBy" :label="i18ns.t('redemption.usedBy')" min-width="160">
            <template #default="{ row }">
              <span v-if="row.usedByUsername">{{ row.usedByUsername }}</span>
              <span v-else-if="row.usedBy">{{ row.usedBy }}</span>
              <span v-else class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('redemption.usedAt')" min-width="180">
            <template #default="{ row }">{{
              row.usedAt ? new Date(row.usedAt).toLocaleString() : '-'
            }}</template>
          </el-table-column>
          <el-table-column :label="i18ns.t('redemption.expiresAt')" min-width="180">
            <template #default="{ row }">{{
              row.expiresAt ? new Date(row.expiresAt).toLocaleString() : '-'
            }}</template>
          </el-table-column>
          <el-table-column :label="i18ns.t('redemption.createdBy')" min-width="150">
            <template #default="{ row }">
              <span v-if="row.createdByUsername">{{ row.createdByUsername }}</span>
              <span v-else>{{ row.createdBy }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="i18ns.t('relay.createTime')" min-width="180">
            <template #default="{ row }">{{ new Date(row.createTime).toLocaleString() }}</template>
          </el-table-column>
          <el-table-column :label="i18ns.t('actions')" width="100">
            <template #default="{ row }">
              <el-button type="danger" size="small" @click="handleDelete(row)">{{
                i18ns.t('delete')
              }}</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="loadCodes"
        @size-change="loadCodes"
        style="margin-top: 20px; justify-content: center"
      />

      <el-dialog v-model="showCreateDialog" :title="i18ns.t('redemption.create')" width="450px">
        <el-form :model="form" label-width="100px">
          <el-form-item :label="i18ns.t('redemption.amount')">
            <el-input-number v-model="form.amount" :min="0.01" :step="1" />
          </el-form-item>
          <el-form-item :label="i18ns.t('redemption.count')">
            <el-input-number v-model="form.count" :min="1" :max="100" :step="1" />
          </el-form-item>
          <el-form-item :label="i18ns.t('redemption.expiresAt')">
            <el-date-picker v-model="form.expiresAt" type="datetime" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showCreateDialog = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="creating" @click="handleCreate">{{
            i18ns.t('confirm')
          }}</el-button>
        </template>
      </el-dialog>
    </el-card>
  </div>
  <div v-else class="mobile-page">
    <el-card class="redemption-mobile mobile-card">
      <template #header>
        <div class="card-header toolbar-row">
          <span class="title">{{ i18ns.t('nav.redemptionCodes') }}</span>
          <el-button type="primary" class="header-btn" @click="showCreateDialog = true">
            {{ i18ns.t('redemption.create') }}
          </el-button>
        </div>
      </template>

      <div v-if="codes.length" class="code-list">
        <el-card v-for="row in codes" :key="row.id" class="code-item mobile-card" shadow="never">
          <div class="code-row">
            <el-link type="primary" class="code-link" @click="copyCode(row.code)">{{
              row.code
            }}</el-link>
            <el-tag v-if="row.usedBy" type="info">{{ i18ns.t('redemption.used') }}</el-tag>
            <el-tag v-else-if="row.expiresAt && new Date(row.expiresAt) < new Date()" type="danger">
              {{ i18ns.t('redemption.expired') }}
            </el-tag>
            <el-tag v-else type="success">{{ i18ns.t('redemption.unused') }}</el-tag>
          </div>
          <div class="meta">
            <div>{{ i18ns.t('redemption.amount') }}: {{ row.amount }}</div>
            <div>
              {{ i18ns.t('redemption.usedBy') }}: {{ row.usedByUsername || row.usedBy || '-' }}
            </div>
            <div>
              {{ i18ns.t('redemption.expiresAt') }}:
              {{ row.expiresAt ? new Date(row.expiresAt).toLocaleString() : '-' }}
            </div>
            <div>
              {{ i18ns.t('relay.createTime') }}: {{ new Date(row.createTime).toLocaleString() }}
            </div>
          </div>
          <el-button type="danger" size="small" class="delete-btn" @click="handleDelete(row)">
            {{ i18ns.t('delete') }}
          </el-button>
        </el-card>
      </div>
      <el-empty v-else />

      <div class="pager-wrap">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          layout="total, prev, pager, next"
          @current-change="loadCodes"
          @size-change="loadCodes"
        />
      </div>

      <el-dialog v-model="showCreateDialog" :title="i18ns.t('redemption.create')" width="92%">
        <el-form :model="form" label-position="top">
          <el-form-item :label="i18ns.t('redemption.amount')">
            <el-input-number v-model="form.amount" :min="0.01" :step="1" style="width: 100%" />
          </el-form-item>
          <el-form-item :label="i18ns.t('redemption.count')">
            <el-input-number
              v-model="form.count"
              :min="1"
              :max="100"
              :step="1"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('redemption.expiresAt')">
            <el-date-picker v-model="form.expiresAt" type="datetime" style="width: 100%" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showCreateDialog = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="creating" @click="handleCreate">{{
            i18ns.t('confirm')
          }}</el-button>
        </template>
      </el-dialog>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { i18ns } from '@/locales'
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { redemptionCodeService } from '@/service/redemptionCodeService'

const { isDesktop } = usePageDevice()

const codes = ref<any[]>([])
const loading = ref(false)
const showCreateDialog = ref(false)
const creating = ref(false)
const form = ref({ amount: 1, count: 1, expiresAt: null as Date | null })

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
})

const loadCodes = async () => {
  loading.value = true
  try {
    const result = await redemptionCodeService.listCodes(pagination.page, pagination.pageSize)
    codes.value = result.data.records
    pagination.total = result.data.total
  } catch (error: any) {
    codes.value = []
    ElMessage.error(error.message || i18ns.t('relay.loadFailed'))
  } finally {
    loading.value = false
  }
}

const copyCode = (code: string) => {
  navigator.clipboard.writeText(code)
  ElMessage.success(i18ns.t('copySuccess'))
}

const handleCreate = async () => {
  creating.value = true
  try {
    await redemptionCodeService.createCodes(
      form.value.amount,
      form.value.count,
      form.value.expiresAt?.toISOString(),
    )
    ElMessage.success(i18ns.t('redemption.createSuccess'))
    showCreateDialog.value = false
    form.value = { amount: 1, count: 1, expiresAt: null }
    pagination.page = 1
    loadCodes()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('relay.createFailed'))
  } finally {
    creating.value = false
  }
}

const handleDelete = async (row: any) => {
  try {
    await redemptionCodeService.deleteCode(row.id)
    ElMessage.success(i18ns.t('redemption.deleteSuccess'))
    loadCodes()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('redemption.deleteFailed'))
  }
}

onMounted(() => loadCodes())
</script>

<style scoped>
.redemption-code-management {
  width: 100%;
  min-width: 0;
}

.redemption-code-management__table-wrap {
  width: 100%;
  min-width: 0;
  overflow-x: auto;
}

.redemption-code-management__table-wrap :deep(.redemption-code-management__table) {
  min-width: 1410px;
}

.redemption-code-management__table-wrap :deep(.el-table__header),
.redemption-code-management__table-wrap :deep(.el-table__body) {
  width: 100% !important;
  table-layout: fixed;
}

.redemption-code-management__table-wrap :deep(.el-table__inner-wrapper),
.redemption-code-management__table-wrap :deep(.el-table__body-wrapper) {
  width: 100%;
}

.redemption-code-management :deep(.el-table .cell) {
  word-break: break-word;
}

.redemption-code-management__code-link {
  display: inline-block;
  max-width: 100%;
  white-space: normal;
  word-break: break-all;
  line-height: 1.4;
}

.redemption-code-management :deep(.redemption-code-management__code-column .cell) {
  white-space: normal;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.muted {
  color: var(--el-text-color-placeholder);
}
</style>

<style scoped>
.redemption-mobile {
  padding: 6px;
}

.redemption-mobile .card-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.redemption-mobile .title {
  font-weight: 600;
}

.redemption-mobile .header-btn {
  width: 100%;
}

.redemption-mobile .code-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.redemption-mobile .code-item {
  border: 1px solid var(--el-border-color-lighter);
}

.redemption-mobile .code-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.redemption-mobile .code-link {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.redemption-mobile .code-link :deep(span) {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.redemption-mobile .meta {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.redemption-mobile .delete-btn {
  margin-top: 8px;
  width: 100%;
}

.redemption-mobile .pager-wrap {
  margin-top: 12px;
  display: flex;
  justify-content: center;
}
</style>
