<template>
  <main class="product-config desktop-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">PLATFORM CONFIGURATION</p>
        <h1>{{ productName(product) }} 产品配置</h1>
        <p>配置全局启停、默认配额、超额定价、资源限制与数据保留期。</p>
      </div>
      <el-button :icon="Refresh" circle aria-label="刷新" @click="load" />
    </header>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" />
    <section class="config-panel" v-loading="loading">
      <el-form label-position="top"
        ><div class="config-section">
          <div>
            <h2>服务开关</h2>
            <p>关闭后所有新调用立即拒绝，已存在资源保留至重新启用或保留期清理。</p>
          </div>
          <el-switch v-model="form.enabled" active-text="已启用" inactive-text="已停用" />
        </div>
        <el-divider />
        <div class="form-grid">
          <el-form-item label="默认每日免费额度"
            ><el-input-number
              v-model="form.defaultDailyQuota"
              :min="0"
              :max="10000000" /></el-form-item
          ><el-form-item label="超额单价"
            ><el-input-number
              v-model="form.overagePrice"
              :min="0"
              :precision="6"
              :step="0.01" /></el-form-item
          ><el-form-item label="默认实例上限"
            ><el-input-number
              v-model="form.defaultInstanceLimit"
              :min="1"
              :max="1000" /></el-form-item
          ><el-form-item label="数据保留天数"
            ><el-input-number v-model="form.retentionDays" :min="1" :max="3650"
          /></el-form-item>
        </div>
        <ProductSettingsEditor
          v-model="resourceLimits"
          label="资源限制"
          description="以独立配置项设置各项资源上限。"
        />
        <ProductSettingsEditor
          v-model="settings"
          label="供应商与产品设置"
          description="以独立配置项设置供应商开关、缓存和重试策略。"
        />
      ></el-form>
      <div class="footer">
        <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
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
import ProductSettingsEditor from './components/ProductSettingsEditor.vue'
const props = defineProps<{ product: DeveloperProductCode }>()
const product = computed(() => props.product)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const resourceLimits = ref<Record<string, unknown>>({})
const settings = ref<Record<string, unknown>>({})
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
    resourceLimits.value = config.resourceLimits || {}
    settings.value = config.settings || {}
  } catch {
    error.value = '产品配置暂时无法加载。'
  } finally {
    loading.value = false
  }
}
const save = async () => {
  saving.value = true
  try {
    await developerProductService.updateConfig(product.value, {
      ...form.value,
      resourceLimits: resourceLimits.value,
      settings: settings.value,
    })
    ElMessage.success('产品配置已保存')
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
@media (max-width: 720px) {
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
