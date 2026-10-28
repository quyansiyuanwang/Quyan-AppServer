<script setup lang="ts">
import { i18ns } from '@/locales'
import { useRemoteTerminalProductManagementContext } from '../context'
const model = defineModel<string | undefined>()
const state = useRemoteTerminalProductManagementContext()
const options = state.templateOptions
const search = (keyword: string) => {
  void state.loadTemplateOptions(1, keyword)
}
const changePage = (page: number) => {
  void state.loadTemplateOptions(page)
}
const visibleChange = (visible: boolean) => {
  if (visible) void state.loadTemplateOptions()
}
</script>

<template>
  <el-select
    v-model="model"
    clearable
    filterable
    remote
    reserve-keyword
    :remote-method="search"
    :loading="options.loading.value"
    :placeholder="i18ns.t('remoteTerminalProduct.selectTemplate')"
    @visible-change="visibleChange"
  >
    <el-option
      v-for="option in state.filterOptions.templates"
      :key="option.id"
      :label="option.name"
      :value="option.id"
    />
    <template #footer>
      <div v-if="options.failed.value" role="alert">
        {{ i18ns.t('remoteTerminalProduct.refreshFailed') }}
        <el-button size="small" @click="changePage(options.page.value)">{{
          i18ns.t('common.refresh')
        }}</el-button>
      </div>
      <el-pagination
        v-else
        small
        layout="prev, pager, next"
        :current-page="options.page.value"
        :page-size="options.pageSize"
        :total="options.total.value"
        :disabled="options.loading.value"
        @current-change="changePage"
      />
    </template>
  </el-select>
</template>
