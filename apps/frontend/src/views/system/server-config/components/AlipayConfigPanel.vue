<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { AlipayConfigDto, AlipayCredentialsDto, AlipaySettingsDto } from '@/client/types.gen'
import { alipayService } from '@/service/alipayService'
import { i18ns } from '@/locales'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import { ElMessage } from '@/utils/elementPlusRuntime'

const settings = ref<AlipaySettingsDto>()
const profile = ref<AlipayConfigDto['profile']>()
const replacing = ref(false)
const saving = ref(false)
const loaded = ref(false)
const credentials = reactive<AlipayCredentialsDto>({
  appId: '',
  sellerId: '',
  sandbox: true,
  keyType: 'PKCS8',
  privateKey: '',
  alipayPublicKey: '',
  appCertContent: '',
  alipayPublicCertContent: '',
  alipayRootCertContent: '',
})
async function load() {
  if (loaded.value) return
  try {
    const config = await alipayService.config()
    settings.value = config.settings
    profile.value = config.profile
    replacing.value = !config.profile
    loaded.value = true
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('alipay.loadFailed'))
  }
}
async function save() {
  if (!settings.value || saving.value) return
  saving.value = true
  try {
    const config = await alipayService.saveConfig({
      settings: settings.value,
      ...(replacing.value ? { credentials: { ...credentials } } : {}),
    })
    profile.value = config.profile
    settings.value = config.settings
    replacing.value = false
    credentials.privateKey = ''
    credentials.alipayPublicKey = ''
    credentials.appCertContent = ''
    credentials.alipayPublicCertContent = ''
    credentials.alipayRootCertContent = ''
    ElMessage.success(i18ns.t('alipay.saved'))
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('alipay.saveFailed'))
  } finally {
    saving.value = false
  }
}
onMounted(load)
</script>

<template>
  <el-collapse-item name="alipay">
    <template #title
      ><span class="collapse-title">{{ i18ns.t('alipay.configTitle') }}</span></template
    >
    <el-alert :title="i18ns.t('alipay.configHelp')" type="info" :closable="false" />
    <el-button v-if="!settings" @click="load">{{ i18ns.t('refresh') }}</el-button>
    <el-form v-if="settings" label-position="top" autocomplete="off">
      <el-form-item :label="i18ns.t('alipay.enabled')"
        ><el-switch v-model="settings.enabled"
      /></el-form-item>
      <el-form-item :label="i18ns.t('alipay.refundEnabled')"
        ><el-switch v-model="settings.refundEnabled"
      /></el-form-item>
      <el-form-item :label="i18ns.t('alipay.minAmount')"
        ><el-input v-model="settings.minAmount" inputmode="decimal"
      /></el-form-item>
      <el-form-item :label="i18ns.t('alipay.maxAmount')"
        ><el-input v-model="settings.maxAmount" inputmode="decimal"
      /></el-form-item>
      <el-form-item :label="i18ns.t('alipay.timeout')"
        ><el-input-number v-model="settings.orderTimeoutMinutes" :min="5" :max="120"
      /></el-form-item>
      <el-form-item :label="i18ns.t('alipay.returnUrl')"
        ><el-input v-model="settings.returnUrl"
      /></el-form-item>
      <el-alert
        v-if="profile"
        :title="`${profile.appId} / ${profile.sellerId} / ${i18ns.t(profile.sandbox ? 'alipay.sandbox' : 'alipay.production')}`"
        type="success"
        :closable="false"
      />
      <el-checkbox v-model="replacing">{{ i18ns.t('alipay.replaceCredentials') }}</el-checkbox>
      <template v-if="replacing">
        <el-form-item :label="i18ns.t('alipay.sandbox')"
          ><el-switch v-model="credentials.sandbox"
        /></el-form-item>
        <el-form-item label="AppID"><el-input v-model="credentials.appId" /></el-form-item>
        <el-form-item :label="i18ns.t('alipay.sellerId')"
          ><el-input v-model="credentials.sellerId"
        /></el-form-item>
        <el-form-item :label="i18ns.t('alipay.keyType')"
          ><el-select v-model="credentials.keyType"
            ><el-option label="PKCS8" value="PKCS8" /><el-option
              label="PKCS1"
              value="PKCS1" /></el-select
        ></el-form-item>
        <el-form-item :label="i18ns.t('alipay.privateKey')"
          ><el-input v-model="credentials.privateKey" type="textarea" :rows="4" autocomplete="off"
        /></el-form-item>
        <el-form-item :label="i18ns.t('alipay.publicKey')"
          ><el-input v-model="credentials.alipayPublicKey" type="textarea" :rows="3"
        /></el-form-item>
        <el-collapse
          ><el-collapse-item :title="i18ns.t('alipay.certificates')" name="certificates">
            <el-form-item :label="i18ns.t('alipay.appCert')"
              ><el-input v-model="credentials.appCertContent" type="textarea" :rows="3"
            /></el-form-item>
            <el-form-item :label="i18ns.t('alipay.alipayCert')"
              ><el-input v-model="credentials.alipayPublicCertContent" type="textarea" :rows="3"
            /></el-form-item>
            <el-form-item :label="i18ns.t('alipay.rootCert')"
              ><el-input v-model="credentials.alipayRootCertContent" type="textarea" :rows="3"
            /></el-form-item> </el-collapse-item
        ></el-collapse>
      </template>
      <el-button type="primary" :loading="saving" @click="save">{{ i18ns.t('save') }}</el-button>
    </el-form>
  </el-collapse-item>
</template>
