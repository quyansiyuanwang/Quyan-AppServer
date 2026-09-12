<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { carpoolService } from '@/service/carpoolService'
const route = useRoute()
const router = useRouter()
const token = computed(() => String((route.params as { token: string }).token || ''))
const submitting = ref(false)
const accept = async () => {
  submitting.value = true
  try {
    const result = await carpoolService.acceptInvite(token.value)
    ElMessage.success('已加入拼车')
    await router.push({ name: 'carpoolDetail', params: { id: result.data.id } })
  } finally {
    submitting.value = false
  }
}
</script>
<template>
  <section class="page">
    <div class="heading">
      <h1>拼车邀请</h1>
      <p>接受邀请加入拼车后，车主会为你分配付款与额度比例。</p>
    </div>
    <el-alert
      v-if="!token"
      type="error"
      :closable="false"
      title="邀请链接无效：缺少邀请令牌，请向拼车发起人重新索取链接。"
    />
    <el-card v-else style="max-width: 480px">
      <p>你收到了一份拼车邀请，接受后将加入对应拼车单并等待车主分配比例。</p>
      <el-button type="primary" :loading="submitting" @click="accept">接受邀请</el-button>
    </el-card>
  </section>
</template>
