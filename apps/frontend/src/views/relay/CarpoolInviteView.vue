<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { i18ns } from '@/locales'
import { carpoolService } from '@/service/carpoolService'
import type { CarpoolOrderDto } from '@/client/types.gen'
const route = useRoute()
const router = useRouter()
const token = computed(() => String((route.params as { token: string }).token || ''))
const submitting = ref(false)
const accept = async () => {
  submitting.value = true
  try {
    const result = await carpoolService.acceptInvite(token.value)
    const orderId = (result.data as CarpoolOrderDto).id
    ElMessage.success(i18ns.t('carpool.invite.joined'))
    await router.push({ name: 'carpoolDetail', params: { id: orderId } })
  } finally {
    submitting.value = false
  }
}
</script>
<template>
  <section class="page">
    <div class="heading">
      <h1>{{ i18ns.t('carpool.invite.title') }}</h1>
      <p>{{ i18ns.t('carpool.invite.subtitle') }}</p>
    </div>
    <el-alert
      v-if="!token"
      type="error"
      :closable="false"
      :title="i18ns.t('carpool.invite.invalidLink')"
    />
    <el-card v-else style="max-width: 480px">
      <p>{{ i18ns.t('carpool.invite.intro') }}</p>
      <el-button type="primary" :loading="submitting" @click="accept">
        {{ i18ns.t('carpool.invite.accept') }}
      </el-button>
    </el-card>
  </section>
</template>
