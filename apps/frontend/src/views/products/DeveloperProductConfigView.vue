<template>
  <main :class="['product-config', isDesktop ? 'desktop-page' : 'mobile-page']">
    <header class="page-header">
      <div>
        <p class="eyebrow">PLATFORM CONFIGURATION</p>
        <h1>{{ productName(product) }} {{ t('productConfig.titleSuffix') }}</h1>
        <p>{{ t('productConfig.description') }}</p>
      </div>
      <el-button :icon="Refresh" circle :aria-label="t('productConsole.refresh')" @click="load" />
    </header>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false">
      <template #default
        ><el-button link type="primary" @click="load">{{
          t('productFeedback.retry')
        }}</el-button></template
      >
    </el-alert>
    <section class="config-panel" v-loading="loading">
      <el-alert v-if="saveError" :title="saveError" type="error" show-icon :closable="false" />
      <el-form label-position="top"
        ><div class="config-section">
          <div>
            <h2>{{ t('productConfig.serviceSwitch') }}</h2>
            <p>{{ t('productConfig.serviceSwitchDescription') }}</p>
          </div>
          <el-switch
            v-model="form.enabled"
            :active-text="t('productConsole.enabled')"
            :inactive-text="t('productConsole.disabled')"
          />
        </div>
        <el-divider />
        <div class="form-grid">
          <el-form-item :label="t('productConfig.dailyQuota')"
            ><el-tag v-if="form.overagePrice === 0" type="success">∞</el-tag
            ><el-input-number
              v-else
              v-model="form.defaultDailyQuota"
              :min="0"
              :max="10000000" /></el-form-item
          ><el-form-item :label="t('productConfig.overagePrice')"
            ><el-input-number v-model="form.overagePrice" :min="0" :precision="6" :step="0.01" />
            <p class="field-hint">{{ t('productConfig.freeUnlimitedHint') }}</p></el-form-item
          ><el-form-item :label="t('productConfig.instanceLimit')"
            ><el-input-number v-model="form.defaultInstanceLimit" :min="1" :max="1000"
          /></el-form-item>
        </div>
      </el-form>
      <div class="footer">
        <el-button type="primary" :loading="saving" @click="save">{{ t('save') }}</el-button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import type { DeveloperProductCode } from '@/client/types.gen'
import { developerProductService } from '@/service/developerProductService'
import { productName } from './developer-product-ui'
import { i18ns } from '@/locales'
import { usePageDevice } from '@/composables/usePageDevice'
import { getErrorMessage } from '@/utils/error-utils'
const props = defineProps<{ product: DeveloperProductCode }>()
const { t } = i18ns
const { isDesktop } = usePageDevice()
const product = computed(() => props.product)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const saveError = ref('')
const form = ref({
  enabled: false,
  defaultDailyQuota: 0,
  overagePrice: 0,
  defaultInstanceLimit: 1,
  retentionDays: 30,
})
const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const config = (await developerProductService.listConfigs()).find(
      (item) => item.productCode === product.value,
    )
    if (!config) return
    form.value = {
      enabled: config.enabled,
      defaultDailyQuota: config.defaultDailyQuota,
      overagePrice: config.overagePrice,
      defaultInstanceLimit: config.defaultInstanceLimit,
      retentionDays: config.retentionDays,
    }
  } catch (cause) {
    error.value = getErrorMessage(cause, t('productConfig.loadError'))
    ElMessage.error(error.value)
  } finally {
    loading.value = false
  }
}
const save = async () => {
  if (saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    await developerProductService.updateConfig(product.value, {
      ...form.value,
      // These fields remain in the API contract but have no runtime consumer yet.
      resourceLimits: {},
      settings: {},
    })
    ElMessage.success(t('productConfig.saved'))
  } catch (cause) {
    saveError.value = getErrorMessage(cause, t('productFeedback.operationFailed'))
    ElMessage.error(saveError.value)
  } finally {
    saving.value = false
  }
}
watch(product, load)
onMounted(load)
</script>

<style scoped lang="scss">
.product-config {
  width: 100%;
  min-width: 0;
  min-height: 100%;
  box-sizing: border-box;
  padding: 28px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 24px;
}
.page-header h1 {
  font-size: 28px;
  margin: 4px 0 8px;
}
.page-header p,
.config-section p {
  margin: 0;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.eyebrow {
  color: var(--el-color-primary);
  font: 700 12px monospace;
  letter-spacing: 0;
}
.config-panel {
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  padding: 24px;
  background: var(--el-bg-color);
}
.config-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.config-section h2 {
  font-size: 17px;
  margin: 0 0 6px;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}
.field-hint {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
@media (max-width: 768px) {
  .product-config {
    padding: 16px;
  }
  .page-header h1 {
    font-size: 22px;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
  .config-section {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
