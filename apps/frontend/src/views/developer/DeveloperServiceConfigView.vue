<template>
  <main class="developer-config-page" v-loading="loading">
    <header class="page-header">
      <div>
        <h1>开发者服务配置</h1>
        <p>配置按量服务的超额单价和短信适配器参数。敏感令牌只可更新，加载时不会显示。</p>
      </div>
      <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
    </header>

    <el-alert class="config-alert" type="warning" :closable="false" show-icon>
      密钥托管主密钥和 IP 定位供应商地址由部署环境变量控制，不会出现在管理界面中。
    </el-alert>

    <section class="config-section">
      <div class="section-heading">
        <h2>超额计费</h2>
        <p>单位为站内余额；仅在项目免费额度用尽且项目允许超额调用时生效。</p>
      </div>
      <el-form label-position="top" class="pricing-grid">
        <el-form-item label="验证码单价">
          <el-input-number v-model="form.verificationPrice" :min="0" :precision="6" :step="0.001" />
        </el-form-item>
        <el-form-item label="IP 定位单价">
          <el-input-number v-model="form.ipPrice" :min="0" :precision="6" :step="0.001" />
        </el-form-item>
        <el-form-item label="推送投递单价">
          <el-input-number v-model="form.pushPrice" :min="0" :precision="6" :step="0.001" />
        </el-form-item>
      </el-form>
    </section>

    <section class="config-section">
      <div class="section-heading">
        <h2>短信适配器</h2>
        <p>配置后验证码 API 可使用短信渠道。留空令牌会保留当前值。</p>
      </div>
      <el-form label-position="top" class="sms-grid">
        <el-form-item label="服务地址">
          <el-input
            v-model.trim="form.smsEndpoint"
            placeholder="https://sms-provider.example/send"
          />
        </el-form-item>
        <el-form-item label="发送方">
          <el-input v-model.trim="form.smsSender" placeholder="AppServer" />
        </el-form-item>
        <el-form-item label="访问令牌">
          <el-input
            v-model="form.smsToken"
            type="password"
            show-password
            placeholder="输入新令牌以更新"
          />
          <div class="field-hint">
            {{ smsTokenConfigured ? '当前已配置令牌' : '当前尚未配置令牌' }}
          </div>
        </el-form-item>
      </el-form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { configService } from '@/service/configService'

const CONFIG_KEYS = {
  verificationPrice: 'developer.pricing.verification',
  ipPrice: 'developer.pricing.ip',
  pushPrice: 'developer.pricing.push',
  smsEndpoint: 'developer.sms.endpoint',
  smsToken: 'developer.sms.token',
  smsSender: 'developer.sms.sender',
} as const

const loading = ref(false)
const saving = ref(false)
const smsTokenConfigured = ref(false)
const form = ref({
  verificationPrice: 0,
  ipPrice: 0,
  pushPrice: 0,
  smsEndpoint: '',
  smsSender: '',
  smsToken: '',
})

const toNumber = (value?: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const load = async () => {
  loading.value = true
  try {
    const configs = await configService.getConfigs(Object.values(CONFIG_KEYS))
    form.value.verificationPrice = toNumber(configs[CONFIG_KEYS.verificationPrice])
    form.value.ipPrice = toNumber(configs[CONFIG_KEYS.ipPrice])
    form.value.pushPrice = toNumber(configs[CONFIG_KEYS.pushPrice])
    form.value.smsEndpoint = configs[CONFIG_KEYS.smsEndpoint] ?? ''
    form.value.smsSender = configs[CONFIG_KEYS.smsSender] ?? ''
    smsTokenConfigured.value = Boolean(configs[CONFIG_KEYS.smsToken])
  } catch (error: any) {
    ElMessage.error(error?.message || '开发者服务配置加载失败')
  } finally {
    loading.value = false
  }
}

const save = async () => {
  saving.value = true
  try {
    const configs: Record<string, string> = {
      [CONFIG_KEYS.verificationPrice]: String(form.value.verificationPrice),
      [CONFIG_KEYS.ipPrice]: String(form.value.ipPrice),
      [CONFIG_KEYS.pushPrice]: String(form.value.pushPrice),
      [CONFIG_KEYS.smsEndpoint]: form.value.smsEndpoint,
      [CONFIG_KEYS.smsSender]: form.value.smsSender,
    }
    if (form.value.smsToken) configs[CONFIG_KEYS.smsToken] = form.value.smsToken
    await configService.setConfigs(configs)
    form.value.smsToken = ''
    smsTokenConfigured.value = smsTokenConfigured.value || Boolean(configs[CONFIG_KEYS.smsToken])
    ElMessage.success('开发者服务配置已保存')
  } catch (error: any) {
    ElMessage.error(error?.message || '开发者服务配置保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => void load())
</script>

<style scoped>
.developer-config-page {
  max-width: 1040px;
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
.page-header h1,
.section-heading h2 {
  margin: 0;
  font-weight: 600;
}
.page-header h1 {
  font-size: 22px;
}
.page-header p,
.section-heading p,
.field-hint {
  color: var(--el-text-color-secondary);
}
.page-header p,
.section-heading p {
  margin: 8px 0 0;
}
.config-alert {
  margin-bottom: 16px;
}
.config-section {
  padding: 20px 0 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.config-section:last-child {
  border-bottom: 0;
}
.section-heading {
  margin-bottom: 16px;
}
.section-heading h2 {
  font-size: 16px;
}
.pricing-grid,
.sms-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 16px;
}
.sms-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.field-hint {
  margin-top: 6px;
  font-size: 12px;
}
@media (max-width: 640px) {
  .developer-config-page {
    padding: 16px;
  }
  .page-header {
    display: block;
  }
  .page-header > .el-button {
    margin-top: 16px;
  }
  .pricing-grid,
  .sms-grid {
    grid-template-columns: 1fr;
  }
}
</style>
