<template>
  <el-dialog
    v-model="batchProfileDialogOpen"
    :title="i18ns.t('relay.channelProbeBatchConfigureTitle')"
    width="min(720px, 94vw)"
    append-to-body
    destroy-on-close
    @closed="resetBatchProfileDialog"
  >
    <el-alert
      type="info"
      :closable="false"
      show-icon
      :title="i18ns.t('relay.channelProbeBatchConfigureHelp')"
    />
    <el-form label-position="top" class="mt-4">
      <el-form-item :label="i18ns.t('relay.channelProbeBatchSource')">
        <el-select v-model="batchProfileSourceChannelId" class="w-full">
          <el-option
            v-for="item in batchProfileSources"
            :key="item.channelId"
            :label="item.channelName"
            :value="item.channelId"
          >
            <span>{{ item.channelName }}</span>
            <span class="ml-2 text-xs text-[#909399]">{{
              item.profile?.probeFormat + ' / ' + item.profile?.probeModel
            }}</span>
          </el-option>
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-checkbox v-model="batchProfileOverwriteExisting">{{
          i18ns.t('relay.channelProbeBatchOverwrite')
        }}</el-checkbox>
      </el-form-item>
    </el-form>
    <el-table :data="batchProfileTargets" max-height="320" class="w-full">
      <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="180" />
      <el-table-column :label="i18ns.t('relay.channelProbeConfigured')" width="128">
        <template #default="{ row }">
          <el-tag size="small" :type="row.profile ? 'warning' : 'success'">{{
            row.profile
              ? i18ns.t('relay.channelProbeBatchWillOverwrite')
              : i18ns.t('relay.channelProbeBatchWillCreate')
          }}</el-tag>
        </template>
      </el-table-column>
    </el-table>
    <template #footer>
      <el-button @click="batchProfileDialogOpen = false">{{ i18ns.t('cancel') }}</el-button>
      <el-button
        type="primary"
        :disabled="!batchProfileSourceChannelId || batchProfileTargets.length === 0"
        :loading="batchProfileSaving"
        @click="submitBatchProfileCopy"
        >{{ i18ns.t('confirm') }}</el-button
      >
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRelayChannelProbeManagementContext } from '../context'

const {
  batchProfileDialogOpen,
  batchProfileOverwriteExisting,
  batchProfileSourceChannelId,
  batchProfileSources,
  batchProfileSaving,
  batchProfileTargets,
  resetBatchProfileDialog,
  submitBatchProfileCopy,
} = useRelayChannelProbeManagementContext()
</script>
