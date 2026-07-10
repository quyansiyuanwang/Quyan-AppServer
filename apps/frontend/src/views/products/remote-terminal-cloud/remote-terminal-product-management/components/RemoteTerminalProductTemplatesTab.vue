<script setup lang="ts">
import { useRemoteTerminalProductManagementContext } from '../context'

const state = useRemoteTerminalProductManagementContext()
</script>

<template>
  <div class="toolbar-row">
    <el-input
      v-model="state.templateKeyword"
      class="toolbar-input"
      clearable
      :placeholder="$t('remoteTerminalProduct.searchTemplatePlaceholder')"
    />
    <el-select
      v-model="state.templateStatus"
      class="toolbar-select"
      clearable
      :placeholder="$t('common.status')"
    >
      <el-option
        v-for="option in state.filterOptions.templateStatusOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
    <div style="flex: 1" />
    <el-button v-if="state.canWriteTemplate" type="primary" @click="state.openCreateTemplateDialog">
      {{ $t('remoteTerminalProduct.createTemplate') }}
    </el-button>
  </div>

  <el-table :data="state.templates" border stripe>
    <el-table-column
      prop="name"
      :label="$t('remoteTerminalProduct.templateName')"
      min-width="180"
    />
    <el-table-column :label="$t('remoteTerminalProduct.offeredUnits')" min-width="220">
      <template #default="{ row }">
        <div class="tag-stack">
          <el-tag v-if="state.supportsDevice(row)" type="success">
            {{ $t('remoteTerminalProduct.deviceQuota') }}:
            {{ state.formatUnitPrice(row.devicePrice, row.currency, row.billingUnit) }}
          </el-tag>
          <el-tag v-if="state.supportsTerminal(row)" type="warning">
            {{ $t('remoteTerminalProduct.terminalQuota') }}:
            {{ state.formatUnitPrice(row.terminalPrice, row.currency, row.billingUnit) }}
          </el-tag>
          <span
            v-if="!state.supportsDevice(row) && !state.supportsTerminal(row)"
            class="secondary-text"
          >
            -
          </span>
        </div>
      </template>
    </el-table-column>
    <el-table-column :label="$t('remoteTerminalProduct.purchaseRule')" min-width="220">
      <template #default="{ row }">
        <div>
          {{
            $t('remoteTerminalProduct.minimumPurchaseUnitsValue', {
              count: row.minimumPurchaseUnits,
            })
          }}
        </div>
        <div class="secondary-text">
          {{ state.formatTemplatePurchaseLimit(row) }}
        </div>
      </template>
    </el-table-column>
    <el-table-column :label="$t('remoteTerminalProduct.deviceConstraints')" min-width="180">
      <template #default="{ row }">
        <div>
          {{ $t('remoteTerminalProduct.minDeviceCountLabel') }}:
          {{ row.minimumDeviceCount ?? '-' }}
        </div>
        <div>
          {{ $t('remoteTerminalProduct.maxDeviceCountLabel') }}:
          {{ row.maxDeviceCount ?? '-' }}
        </div>
      </template>
    </el-table-column>
    <el-table-column :label="$t('remoteTerminalProduct.terminalConstraints')" min-width="180">
      <template #default="{ row }">
        <div>
          {{ $t('remoteTerminalProduct.minTerminalCountLabel') }}:
          {{ row.minimumTerminalCount ?? '-' }}
        </div>
        <div>
          {{ $t('remoteTerminalProduct.maxTerminalCountLabel') }}:
          {{ row.maxTerminalCount ?? '-' }}
        </div>
      </template>
    </el-table-column>
    <el-table-column :label="$t('common.status')" width="120">
      <template #default="{ row }">
        <el-tag :type="row.status === 1 ? 'success' : 'info'">
          {{ row.statusLabel || row.status }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column :label="$t('remoteTerminalProduct.publishStatus')" width="140">
      <template #default="{ row }">
        <el-tag :type="row.publishedAt ? 'success' : 'info'">
          {{
            row.publishedAt
              ? $t('remoteTerminalProduct.published')
              : $t('remoteTerminalProduct.unpublished')
          }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column :label="$t('common.actions')" fixed="right" width="260">
      <template #default="{ row }">
        <div class="token-actions">
          <el-button link type="primary" @click="state.openEditTemplateDialog(row)">
            {{ $t('common.edit') }}
          </el-button>
          <el-button
            v-if="state.canWriteTemplate && !row.publishedAt"
            link
            type="success"
            @click="state.handlePublish(row.id)"
          >
            {{ $t('remoteTerminalProduct.publish') }}
          </el-button>
          <el-button
            v-if="state.canWriteTemplate && row.publishedAt"
            link
            type="warning"
            @click="state.handleUnpublish(row.id)"
          >
            {{ $t('remoteTerminalProduct.unpublish') }}
          </el-button>
          <el-button
            v-if="state.canWriteTemplate"
            link
            type="danger"
            @click="state.handleDeleteTemplate(row.id)"
          >
            {{ $t('common.delete') }}
          </el-button>
        </div>
      </template>
    </el-table-column>
  </el-table>
</template>
