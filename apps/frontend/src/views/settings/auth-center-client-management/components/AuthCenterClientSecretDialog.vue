<template>
  <el-dialog
    v-model="showSecretDialog"
    :close-on-click-modal="false"
    :title="i18ns.t('authCenterClient.secretDialogTitle')"
    :width="isDesktop ? '640px' : '96%'"
  >
    <el-alert type="warning" :closable="false" style="margin-bottom: 16px">
      {{ i18ns.t('authCenterClient.secretWarning') }}
    </el-alert>
    <el-input v-if="isDesktop" v-model="createdSecret" readonly>
      <template #append>
        <el-button type="primary" @click="copyCreatedSecret">{{ i18ns.t('copy') }}</el-button>
      </template>
    </el-input>
    <el-input v-else v-model="createdSecret" readonly type="textarea" :rows="3" />
    <template #footer>
      <el-button v-if="!isDesktop" @click="copyCreatedSecret">{{ i18ns.t('copy') }}</el-button>
      <el-button type="primary" @click="showSecretDialog = false">
        {{ i18ns.t('confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useAuthCenterClientManagementContext } from '../context'

const { isDesktop, showSecretDialog, createdSecret, copyCreatedSecret } =
  useAuthCenterClientManagementContext()
</script>
