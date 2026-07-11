<template>
  <el-dialog
    v-model="visible"
    :close-on-click-modal="false"
    :title="i18ns.t('oauthClient.secretDialogTitle')"
    :width="props.isDesktop ? '640px' : '96%'"
  >
    <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
      {{ i18ns.t('oauthClient.secretWarning') }}
    </el-alert>
    <el-input v-if="props.isDesktop" :model-value="props.createdSecret" readonly>
      <template #append>
        <el-button type="primary" @click="emit('copy')">{{ i18ns.t('copy') }}</el-button>
      </template>
    </el-input>
    <el-input v-else :model-value="props.createdSecret" readonly type="textarea" :rows="3" />
    <template #footer>
      <el-button v-if="!props.isDesktop" @click="emit('copy')">{{ i18ns.t('copy') }}</el-button>
      <el-button type="primary" @click="visible = false">{{ i18ns.t('confirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'

const visible = defineModel<boolean>({ required: true })

const props = defineProps<{
  isDesktop: boolean
  createdSecret: string
}>()

const emit = defineEmits<{
  (e: 'copy'): void
}>()
</script>
