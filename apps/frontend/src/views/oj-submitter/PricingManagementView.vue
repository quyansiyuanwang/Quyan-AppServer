<template>
  <div v-if="isDesktop" class="desktop-page">
    <el-card class="page-card">
      <template #header>
        <div class="pricing-page-header">
          <span class="pricing-page-title">{{ i18ns.t('ojSubmitter.pricing') }}</span>
          <PermissionWrapper :require="Permission.OJ_PRICING_UPDATE">
            <el-button type="primary" @click="openCreateDialog">
              {{ i18ns.t('ojSubmitter.addModel') }}
            </el-button>
          </PermissionWrapper>
        </div>
      </template>

      <el-table :data="pricings" style="width: 100%" v-loading="loading">
        <el-table-column prop="model" :label="i18ns.t('ojSubmitter.model')" min-width="200" />
        <el-table-column
          prop="provider"
          :label="i18ns.t('ojSubmitter.provider')"
          width="100"
          class-name="hide-on-mobile"
        />
        <el-table-column :label="i18ns.t('ojSubmitter.inputPrice')" width="160">
          <template #default="{ row }">
            {{ row.inputPrice }} {{ i18ns.t('ojSubmitter.priceUnit') }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('ojSubmitter.outputPrice')" width="160">
          <template #default="{ row }">
            {{ row.outputPrice }} {{ i18ns.t('ojSubmitter.priceUnit') }}
          </template>
        </el-table-column>
        <el-table-column
          prop="multiplier"
          :label="i18ns.t('ojSubmitter.multiplier')"
          width="100"
          class-name="hide-on-mobile"
        />
        <el-table-column
          prop="cacheCreationMultiplier"
          :label="i18ns.t('ojSubmitter.cacheCreationMultiplier')"
          width="140"
          class-name="hide-on-mobile"
        />
        <el-table-column
          prop="cacheReadMultiplier"
          :label="i18ns.t('ojSubmitter.cacheReadMultiplier')"
          width="130"
          class-name="hide-on-mobile"
        />
        <el-table-column :label="i18ns.t('actions')" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEditDialog(row)">{{ i18ns.t('edit') }}</el-button>
            <el-button size="small" type="danger" @click="handleDelete(row)">{{
              i18ns.t('delete')
            }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- Create / Edit Dialog -->
      <el-dialog
        v-model="showDialog"
        :title="editingModel ? i18ns.t('ojSubmitter.editModel') : i18ns.t('ojSubmitter.addModel')"
        width="560px"
      >
        <el-form :model="form" :rules="rules" ref="formRef" label-width="150px">
          <el-form-item :label="i18ns.t('ojSubmitter.model')" prop="model">
            <el-input
              v-model="form.model"
              :disabled="!!editingModel"
              placeholder="e.g. claude-3-haiku-20240307"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('ojSubmitter.provider')" prop="provider">
            <el-input v-model="form.provider" placeholder="e.g. Anthropic" />
          </el-form-item>
          <el-form-item :label="i18ns.t('ojSubmitter.inputPrice')" prop="inputPrice">
            <el-input-number
              v-model="form.inputPrice"
              :min="0"
              :precision="2"
              :step="0.5"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('ojSubmitter.outputPrice')" prop="outputPrice">
            <el-input-number
              v-model="form.outputPrice"
              :min="0"
              :precision="2"
              :step="0.5"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('ojSubmitter.multiplier')" prop="multiplier">
            <el-input-number
              v-model="form.multiplier"
              :min="0"
              :precision="2"
              :step="0.1"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item
            :label="i18ns.t('ojSubmitter.cacheCreationMultiplier')"
            prop="cacheCreationMultiplier"
          >
            <el-input-number
              v-model="form.cacheCreationMultiplier"
              :min="0"
              :precision="2"
              :step="0.1"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item
            :label="i18ns.t('ojSubmitter.cacheReadMultiplier')"
            prop="cacheReadMultiplier"
          >
            <el-input-number
              v-model="form.cacheReadMultiplier"
              :min="0"
              :precision="2"
              :step="0.01"
              style="width: 100%"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showDialog = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="saving" @click="handleSubmit">{{
            i18ns.t('save')
          }}</el-button>
        </template>
      </el-dialog>
    </el-card>
  </div>
  <div v-else class="mobile-page">
    <div class="oj-pricing-mobile">
      <el-card class="mobile-card">
        <template #header>
          <div class="card-header toolbar-row">
            <span>{{ i18ns.t('ojSubmitter.pricing') }}</span>
            <PermissionWrapper :require="Permission.OJ_PRICING_UPDATE">
              <el-button type="primary" @click="openCreateDialog">{{
                i18ns.t('ojSubmitter.addModel')
              }}</el-button>
            </PermissionWrapper>
          </div>
        </template>

        <el-skeleton :loading="loading" :rows="5" animated>
          <div v-if="pricings.length" class="pricing-list">
            <el-card
              v-for="row in pricings"
              :key="row.model"
              class="pricing-item mobile-card"
              shadow="never"
            >
              <div class="item-header">
                <div class="model">{{ row.model }}</div>
                <el-tag size="small" type="info" class="provider-tag">{{
                  row.provider || '-'
                }}</el-tag>
              </div>
              <div class="meta">
                <div class="meta-row">
                  <span class="meta-label">{{ i18ns.t('ojSubmitter.inputPrice') }}</span>
                  <span class="meta-value">
                    {{ row.inputPrice }} {{ i18ns.t('ojSubmitter.priceUnit') }}
                  </span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">{{ i18ns.t('ojSubmitter.outputPrice') }}</span>
                  <span class="meta-value">
                    {{ row.outputPrice }} {{ i18ns.t('ojSubmitter.priceUnit') }}
                  </span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">{{ i18ns.t('ojSubmitter.multiplier') }}</span>
                  <span class="meta-value">{{ row.multiplier }}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">{{
                    i18ns.t('ojSubmitter.cacheCreationMultiplier')
                  }}</span>
                  <span class="meta-value">{{ row.cacheCreationMultiplier }}</span>
                </div>
                <div class="meta-row">
                  <span class="meta-label">{{ i18ns.t('ojSubmitter.cacheReadMultiplier') }}</span>
                  <span class="meta-value">{{ row.cacheReadMultiplier }}</span>
                </div>
              </div>
              <div class="actions">
                <el-button size="small" type="primary" plain @click="openEditDialog(row)">{{
                  i18ns.t('edit')
                }}</el-button>
                <el-button size="small" type="danger" plain @click="handleDelete(row)">{{
                  i18ns.t('delete')
                }}</el-button>
              </div>
            </el-card>
          </div>
          <el-empty v-else />
        </el-skeleton>
      </el-card>

      <el-dialog
        v-model="showDialog"
        :title="editingModel ? i18ns.t('ojSubmitter.editModel') : i18ns.t('ojSubmitter.addModel')"
        width="96%"
      >
        <el-form :model="form" :rules="rules" ref="formRef" label-position="top">
          <el-form-item :label="i18ns.t('ojSubmitter.model')" prop="model">
            <el-input v-model="form.model" :disabled="!!editingModel" />
          </el-form-item>
          <el-form-item :label="i18ns.t('ojSubmitter.provider')" prop="provider">
            <el-input v-model="form.provider" />
          </el-form-item>
          <el-form-item :label="i18ns.t('ojSubmitter.inputPrice')" prop="inputPrice">
            <el-input-number
              v-model="form.inputPrice"
              :min="0"
              :precision="2"
              :step="0.5"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('ojSubmitter.outputPrice')" prop="outputPrice">
            <el-input-number
              v-model="form.outputPrice"
              :min="0"
              :precision="2"
              :step="0.5"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item :label="i18ns.t('ojSubmitter.multiplier')" prop="multiplier">
            <el-input-number
              v-model="form.multiplier"
              :min="0"
              :precision="2"
              :step="0.1"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item
            :label="i18ns.t('ojSubmitter.cacheCreationMultiplier')"
            prop="cacheCreationMultiplier"
          >
            <el-input-number
              v-model="form.cacheCreationMultiplier"
              :min="0"
              :precision="2"
              :step="0.1"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item
            :label="i18ns.t('ojSubmitter.cacheReadMultiplier')"
            prop="cacheReadMultiplier"
          >
            <el-input-number
              v-model="form.cacheReadMultiplier"
              :min="0"
              :precision="2"
              :step="0.01"
              style="width: 100%"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showDialog = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="saving" @click="handleSubmit">{{
            i18ns.t('save')
          }}</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePageDevice } from '@/composables/usePageDevice'
import { ref, onMounted } from 'vue'
import { i18ns } from '@/locales'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { OJPricingService } from '@/service/ojPricingService'
import type { OjModelPricingDto } from '@/client/types.gen'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { Permission } from '@/constant/permission'

const ojPricingService = OJPricingService.getInstance()
const pricings = ref<OjModelPricingDto[]>([])
const loading = ref(false)
const saving = ref(false)
const showDialog = ref(false)
const editingModel = ref<string | null>(null)
const formRef = ref<FormInstance>()

const defaultForm = () => ({
  model: '',
  provider: '',
  inputPrice: 0,
  outputPrice: 0,
  multiplier: 1.0,
  cacheCreationMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
})

const form = ref(defaultForm())

const rules = {
  model: [{ required: true, message: 'Model name is required', trigger: 'blur' }],
  inputPrice: [{ required: true, message: 'Input price is required', trigger: 'blur' }],
  outputPrice: [{ required: true, message: 'Output price is required', trigger: 'blur' }],
}

const loadPricing = async () => {
  loading.value = true
  try {
    const result = await ojPricingService.listPricing()
    pricings.value = result as unknown as OjModelPricingDto[]
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('ojSubmitter.pricingLoadFailed'))
  } finally {
    loading.value = false
  }
}

const openCreateDialog = () => {
  editingModel.value = null
  form.value = defaultForm()
  showDialog.value = true
}

const openEditDialog = (row: OjModelPricingDto) => {
  editingModel.value = row.model
  form.value = {
    model: row.model,
    provider: row.provider || '',
    inputPrice: row.inputPrice,
    outputPrice: row.outputPrice,
    multiplier: row.multiplier,
    cacheCreationMultiplier: row.cacheCreationMultiplier,
    cacheReadMultiplier: row.cacheReadMultiplier,
  }
  showDialog.value = true
}

const handleSubmit = async () => {
  await formRef.value?.validate()
  saving.value = true
  try {
    if (editingModel.value) {
      await ojPricingService.updatePricing(editingModel.value, {
        inputPrice: form.value.inputPrice,
        outputPrice: form.value.outputPrice,
        multiplier: form.value.multiplier,
        cacheCreationMultiplier: form.value.cacheCreationMultiplier,
        cacheReadMultiplier: form.value.cacheReadMultiplier,
        provider: form.value.provider || undefined,
      })
      ElMessage.success(i18ns.t('ojSubmitter.pricingUpdateSuccess'))
    } else {
      await ojPricingService.createPricing({
        model: form.value.model,
        inputPrice: form.value.inputPrice,
        outputPrice: form.value.outputPrice,
        multiplier: form.value.multiplier,
        cacheCreationMultiplier: form.value.cacheCreationMultiplier,
        cacheReadMultiplier: form.value.cacheReadMultiplier,
        provider: form.value.provider || undefined,
      })
      ElMessage.success(i18ns.t('ojSubmitter.pricingCreateSuccess'))
    }
    showDialog.value = false
    loadPricing()
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('error'))
  } finally {
    saving.value = false
  }
}

const handleDelete = async (row: OjModelPricingDto) => {
  try {
    await ElMessageBox.confirm(i18ns.t('ojSubmitter.confirmDeletePricing'), i18ns.t('warning'), {
      type: 'warning',
    })
    await ojPricingService.deletePricing(row.model)
    ElMessage.success(i18ns.t('ojSubmitter.pricingDeleteSuccess'))
    loadPricing()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || i18ns.t('error'))
    }
  }
}

onMounted(() => {
  loadPricing()
})

const { isDesktop } = usePageDevice()
</script>

<style scoped>
.pricing-page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.pricing-page-title {
  font-size: 16px;
  font-weight: 600;
}

@media (max-width: 768px) {
  :deep(.hide-on-mobile) {
    display: none;
  }
  .el-form {
    :deep(.el-form-item) {
      flex-direction: column;
      align-items: flex-start;
    }
    :deep(.el-form-item__label) {
      width: 100% !important;
      text-align: left;
    }
    :deep(.el-form-item__content) {
      margin-left: 0 !important;
      width: 100%;
    }
  }
}
</style>

<style scoped>
.oj-pricing-mobile {
  padding: 8px 6px 16px;
}

.oj-pricing-mobile .card-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.oj-pricing-mobile .card-header .el-button {
  width: 100%;
}

.oj-pricing-mobile .pricing-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.oj-pricing-mobile .pricing-item {
  border: 1px solid var(--el-border-color-lighter);
}

.oj-pricing-mobile :deep(.pricing-item .el-card__body) {
  padding: 12px 12px 10px;
}

.oj-pricing-mobile .item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}

.oj-pricing-mobile .model {
  font-weight: 600;
  word-break: break-word;
}

.oj-pricing-mobile .provider-tag {
  flex-shrink: 0;
}

.oj-pricing-mobile .meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.oj-pricing-mobile .meta-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.oj-pricing-mobile .meta-label {
  line-height: 1.4;
}

.oj-pricing-mobile .meta-value {
  text-align: right;
  color: var(--el-text-color-primary);
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
}

.oj-pricing-mobile .actions {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.oj-pricing-mobile .actions .el-button {
  width: 100%;
  min-height: 34px;
  margin-left: 0 !important;
}

.oj-pricing-mobile :deep(.el-dialog) {
  width: 96% !important;
  max-width: 96% !important;
  margin-top: 3vh !important;
}

.oj-pricing-mobile :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
}

@media (max-width: 380px) {
  .oj-pricing-mobile .actions {
    grid-template-columns: 1fr;
  }
}
</style>
