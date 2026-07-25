<template>
  <ProductApiTestCard
    v-model:api-key="apiKey"
    :title="t('productResources.verificationTestTitle')"
    :description="t('productResources.verificationTestDescription')"
    :error="error"
    :result="result"
  >
    <el-form-item :label="t('productResources.verificationChannel')">
      <el-select v-model="form.channel" style="width: 100%">
        <el-option :label="t('productResources.email')" value="email" />
        <el-option :label="t('productResources.sms')" value="sms" />
      </el-select>
    </el-form-item>
    <el-form-item :label="t('productResources.recipient')">
      <el-input v-model="form.recipient" />
    </el-form-item>
    <el-form-item :label="t('productResources.purpose')">
      <el-input v-model="form.purpose" placeholder="signup" />
    </el-form-item>
    <el-form-item :label="t('productResources.verificationCode')">
      <el-input v-model="form.code" maxlength="6" />
    </el-form-item>
    <template #actions>
      <el-button type="primary" :loading="submitting" @click="send">{{
        t('productResources.sendVerification')
      }}</el-button>
      <el-button :loading="submitting" @click="verify">{{
        t('productResources.verifyCode')
      }}</el-button>
    </template>
  </ProductApiTestCard>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import ProductApiTestCard from '@/views/products/components/ProductApiTestCard.vue'
import { developerProductService } from '@/service/developerProductService'
import { i18ns } from '@/locales'
import { getErrorMessage } from '@/utils/error-utils'

const { t } = i18ns
const apiKey = ref('')
const error = ref('')
const result = ref<unknown>()
const submitting = ref(false)
const form = ref({ channel: 'email' as 'email' | 'sms', recipient: '', purpose: '', code: '' })
const validBaseForm = () =>
  Boolean(apiKey.value.trim() && form.value.recipient.trim() && form.value.purpose.trim())
const request = async (path: '/send' | '/verify') => {
  if (submitting.value) return
  if (!validBaseForm() || (path === '/verify' && !/^\d{6}$/.test(form.value.code.trim()))) {
    error.value = t('productResources.invalidTestRequest')
    return
  }
  submitting.value = true
  error.value = ''
  result.value = undefined
  try {
    result.value = await developerProductService.requestProductApi(
      `/v1/products/verification${path}`,
      apiKey.value,
      'POST',
      {
        channel: form.value.channel,
        recipient: form.value.recipient.trim(),
        purpose: form.value.purpose.trim(),
        ...(path === '/verify' ? { code: form.value.code.trim() } : {}),
      },
    )
    ElMessage.success(t('productResources.testRequestSucceeded'))
  } catch (cause) {
    error.value = getErrorMessage(cause, t('productFeedback.operationFailed'))
    ElMessage.error(error.value)
  } finally {
    submitting.value = false
  }
}
const send = () => request('/send')
const verify = () => request('/verify')
</script>
