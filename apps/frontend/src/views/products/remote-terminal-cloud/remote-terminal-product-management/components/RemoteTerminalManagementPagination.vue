<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { useRemoteTerminalProductManagementContext } from '../context'
import type { RemoteTerminalProductManagementSection } from '../useRemoteTerminalProductManagement'
const props = defineProps<{ section: RemoteTerminalProductManagementSection }>()
const state = useRemoteTerminalProductManagementContext()
const list = computed(() =>
  props.section === 'templates'
    ? state.templateList
    : props.section === 'entitlements'
      ? state.entitlementList
      : state.deviceList,
)
const changePage = (page: number) => {
  if (!list.value.loading.value) void list.value.changePage(page)
}
const changePageSize = (size: number) => {
  if (!list.value.loading.value) void list.value.changePageSize(size)
}
</script>
<template>
  <div class="management-pagination">
    <div v-if="list.failed.value" role="alert">
      {{ i18ns.t('remoteTerminalProduct.refreshFailed') }}
    </div>
    <el-button :loading="list.loading.value" @click="list.load()">{{
      i18ns.t('common.refresh')
    }}</el-button>
    <el-pagination
      :current-page="list.page.value"
      :page-size="list.pageSize.value"
      :total="list.total.value"
      :page-sizes="[20, 50, 100]"
      :disabled="list.loading.value"
      layout="total, sizes, prev, pager, next"
      @current-change="changePage"
      @size-change="changePageSize"
    />
  </div>
</template>
<style scoped>
.management-pagination {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  margin-top: 16px;
}
</style>
