<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRemoteTerminalProductManagementContext } from '../context'
const model = defineModel<string | undefined>()
const options = useRemoteTerminalProductManagementContext().entitlementOptions
const changePage = (page: number) => {
  if (!options.loading.value) void options.changePage(page)
}
const visibleChange = (visible: boolean) => {
  if (visible) void options.load()
}
</script>
<template>
  <el-select
    v-model="model"
    clearable
    :loading="options.loading.value"
    :placeholder="i18ns.t('remoteTerminalProduct.selectEntitlement')"
    @visible-change="visibleChange"
  >
    <el-option
      v-for="option in options.records.value"
      :key="option.id"
      :label="option.name || option.id"
      :value="option.id"
    />
    <template #footer>
      <div v-if="options.failed.value" role="alert">
        {{ i18ns.t('remoteTerminalProduct.refreshFailed') }}
        <el-button size="small" @click="options.load()">{{ i18ns.t('common.refresh') }}</el-button>
      </div>
      <el-pagination
        v-else
        small
        layout="total, prev, pager, next"
        :current-page="options.page.value"
        :page-size="options.pageSize.value"
        :total="options.total.value"
        :disabled="options.loading.value"
        @current-change="changePage"
      />
    </template>
  </el-select>
</template>
