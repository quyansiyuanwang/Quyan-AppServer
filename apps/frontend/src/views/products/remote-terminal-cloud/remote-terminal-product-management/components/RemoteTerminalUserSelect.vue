<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { useRemoteTerminalProductManagementContext } from '../context'
const model = defineModel<string | undefined>()
const state = useRemoteTerminalProductManagementContext(),
  choices = state.userChoices
const options = computed(() => {
  const selected = state.selectedUserOption.value
  return selected &&
    selected.id === model.value &&
    !choices.records.value.some((row) => row.id === selected.id)
    ? [selected, ...choices.records.value]
    : choices.records.value
})
const search = (keyword: string) => {
  state.handleUserSearch(keyword)
}
const changePage = (page: number) => {
  if (!choices.loading.value) void choices.changePage(page)
}
const visibleChange = (visible: boolean) => {
  if (visible) void choices.load()
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
    :loading="choices.loading.value"
    :placeholder="i18ns.t('remoteTerminalProduct.selectUser')"
    @visible-change="visibleChange"
  >
    <el-option v-for="user in options" :key="user.id" :label="user.username" :value="user.id" />
    <template #footer>
      <div v-if="choices.failed.value" role="alert">
        {{ i18ns.t('remoteTerminalProduct.refreshFailed')
        }}<el-button size="small" @click="choices.load()">{{
          i18ns.t('common.refresh')
        }}</el-button>
      </div>
      <el-pagination
        v-else
        small
        layout="total, prev, pager, next"
        :current-page="choices.page.value"
        :page-size="choices.pageSize.value"
        :total="choices.total.value"
        :disabled="choices.loading.value"
        @current-change="changePage"
      />
    </template>
  </el-select>
</template>
