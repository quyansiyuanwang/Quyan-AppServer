<template>
  <el-dialog
    v-model="batchProfileDialogOpen"
    :title="i18ns.t('relay.channelProbeBatchConfigureTitle')"
    width="min(1120px, 96vw)"
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
    <el-alert
      type="warning"
      :closable="false"
      class="mt-3"
      :title="i18ns.t('relay.probeBatchCredentialNotice')"
    />
    <el-table
      :data="batchProfileTargets"
      max-height="430"
      class="w-full mt-3"
      row-key="channelName"
    >
      <el-table-column type="expand" width="42">
        <template #default="{ row }">
          <el-form-item :label="i18ns.t('relay.channelProbePayload')" class="mx-4">
            <el-input v-model="row.probePayload" type="textarea" :rows="5" />
          </el-form-item>
        </template>
      </el-table-column>
      <el-table-column prop="channelName" :label="i18ns.t('relay.channelName')" min-width="160" />
      <el-table-column :label="i18ns.t('relay.channelProbeFormat')" min-width="160">
        <template #default="{ row }"
          ><el-select v-model="row.probeFormat" class="w-full" @change="onFormatChange(row)">
            <el-option
              v-for="format in probeFormats"
              :key="format"
              :value="format"
              :label="format"
              :disabled="row.allowedFormats.length > 0 && !row.allowedFormats.includes(format)"
            /> </el-select
        ></template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeModel')" min-width="175">
        <template #default="{ row }"
          ><el-select
            v-model="row.probeModel"
            filterable
            :allow-create="!row.allowedModels.length"
            class="w-full"
          >
            <el-option
              v-for="model in row.allowedModels"
              :key="model"
              :value="model"
              :label="model"
            /> </el-select
        ></template>
      </el-table-column>
      <el-table-column :label="i18ns.t('relay.channelProbeGroup')" min-width="160">
        <template #default="{ row }"
          ><el-select v-model="row.probeGroup" clearable filterable allow-create class="w-full">
            <el-option
              v-for="group in availableGroups"
              :key="group"
              :value="group"
              :label="group"
            /> </el-select
        ></template>
      </el-table-column>
      <el-table-column
        v-if="canManageAccounts"
        :label="i18ns.t('relay.probeAccounts')"
        min-width="160"
      >
        <template #default="{ row }"
          ><el-select v-model="row.accountId" clearable filterable class="w-full">
            <el-option
              v-for="account in accounts"
              :key="account.id"
              :value="account.id"
              :label="account.name"
            /> </el-select
        ></template>
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
import { RELAY_PROBE_FORMATS } from '@quyan/shared'
import { useRelayChannelProbeManagementContext } from '../context'
import type { RelayProbeFormat } from '@quyan/shared'

const probeFormats = RELAY_PROBE_FORMATS

const {
  accounts,
  availableGroups,
  canManageAccounts,
  batchProfileDialogOpen,
  batchProfileOverwriteExisting,
  batchProfileSourceChannelId,
  batchProfileSources,
  batchProfileSaving,
  batchProfileTargets,
  resetBatchProfileDialog,
  submitBatchProfileCopy,
  createDefaultProbePayload,
  defaultEndpointForFormat,
} = useRelayChannelProbeManagementContext()

function onFormatChange(row: { probeFormat: RelayProbeFormat; probePayload: string }) {
  row.probePayload = JSON.stringify(
    createDefaultProbePayload(row.probeFormat, defaultEndpointForFormat(row.probeFormat)),
    null,
    2,
  )
}
</script>
