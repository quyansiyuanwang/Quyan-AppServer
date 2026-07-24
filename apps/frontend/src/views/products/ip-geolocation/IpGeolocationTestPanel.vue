<template>
  <ProductApiTestCard
    v-model:api-key="apiKey"
    :title="t('productResources.ipTestTitle')"
    :description="t('productResources.ipTestDescription')"
    :error="error"
    :result="result"
  >
    <el-form-item :label="t('productResources.ipAddress')">
      <el-input v-model="ip" placeholder="8.8.8.8" />
    </el-form-item>
    <template #actions>
      <el-button type="primary" :loading="submitting" @click="lookup">{{
        t('productResources.lookupIp')
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
const ip = ref('')
const error = ref('')
const result = ref<unknown>()
const submitting = ref(false)
const lookup = async () => {
  if (submitting.value) return
  if (!apiKey.value.trim() || !ip.value.trim()) {
    error.value = t('productResources.invalidTestRequest')
    return
  }
  submitting.value = true
  error.value = ''
  result.value = undefined
  try {
    result.value = await developerProductService.requestProductApi(
      `/v1/products/ip-geolocation/${encodeURIComponent(ip.value.trim())}`,
      apiKey.value,
      'GET',
    )
    ElMessage.success(t('productResources.testRequestSucceeded'))
  } catch (cause) {
    error.value = getErrorMessage(cause, t('productFeedback.operationFailed'))
    ElMessage.error(error.value)
  } finally {
    submitting.value = false
  }
}
</script>
