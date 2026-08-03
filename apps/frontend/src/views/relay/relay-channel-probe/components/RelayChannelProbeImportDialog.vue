<template>
      <el-dialog
        v-model="importDialogOpen"
        :title="i18ns.t('relay.channelProbeImport')"
        width="min(640px, 92vw)"
        append-to-body
        :close-on-click-modal="false"
      >
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          :title="i18ns.t('relay.channelProbeImportCredentialNotice')"
          class="mb-3"
        />
        <el-input
          v-model="importText"
          type="textarea"
          :rows="14"
          :placeholder="i18ns.t('relay.channelProbeImportPlaceholder')"
        />
        <input
          ref="importFileInput"
          class="hidden-file-input"
          type="file"
          accept="application/json,.json"
          @change="readImportFile"
        />
        <template #footer>
          <el-button :icon="Upload" @click="triggerImportFile">{{
            i18ns.t('relay.channelProbeImportFile')
          }}</el-button>
          <el-button @click="importDialogOpen = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" @click="applyImportedConfiguration">{{
            i18ns.t('relay.channelProbeImportApply')
          }}</el-button>
        </template>
      </el-dialog>
</template>

<script setup lang="ts">
import { Upload } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { useRelayChannelProbeManagementContext } from '../context'

const { applyImportedConfiguration, importDialogOpen, importFileInput, importText, readImportFile, triggerImportFile } = useRelayChannelProbeManagementContext()
</script>

