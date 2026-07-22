<template>
  <section class="relay-channel-management" v-loading="channelLoading">
    <div class="relay-channel-management__toolbar">
      <div class="relay-channel-management__primary-actions">
        <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
          <el-button type="primary" @click="openCreateChannelDialog">
            <el-icon><Plus /></el-icon>
            {{ i18ns.t('relay.createChannel') }}
          </el-button>
        </PermissionWrapper>
        <PermissionWrapper :require="[Permission.RELAY_CHANNEL_CREATE]">
          <el-button @click="openChannelImportDialog">{{
            i18ns.t('relay.importChannels')
          }}</el-button>
        </PermissionWrapper>
        <PermissionWrapper :require="[Permission.RELAY_CHANNEL_EXPORT]">
          <el-button :loading="channelExporting" @click="exportChannelsAsJson">
            {{ i18ns.t('relay.exportChannels') }}
          </el-button>
        </PermissionWrapper>
      </div>
      <div class="relay-channel-management__filters">
        <el-input
          :model-value="channelFilters.keyword"
          clearable
          :placeholder="i18ns.t('relay.channelName')"
          @update:model-value="setChannelKeyword"
        >
          <template #prefix
            ><el-icon><Search /></el-icon
          ></template>
        </el-input>
        <el-select
          :model-value="channelFilters.channelType"
          clearable
          :placeholder="i18ns.t('relay.channelType')"
          @update:model-value="updateChannelFilters({ channelType: $event })"
        >
          <el-option :label="i18ns.t('relay.channelTypeStandalone')" value="standalone" />
          <el-option :label="i18ns.t('relay.channelTypePooled')" value="pooled" />
          <el-option
            :label="i18ns.t('relay.channelTypeAutomaticProxyPool')"
            value="automatic-proxy-pool"
          />
        </el-select>
        <el-select
          :model-value="channelFilters.enabled"
          clearable
          :placeholder="i18ns.t('status')"
          @update:model-value="updateChannelFilters({ enabled: $event })"
        >
          <el-option :label="i18ns.t('relay.enabled')" :value="true" />
          <el-option :label="i18ns.t('relay.disabled')" :value="false" />
        </el-select>
      </div>
    </div>

    <div class="relay-channel-management__selection">
      <el-checkbox :model-value="isCurrentPageFullySelected" @change="toggleCurrentPageSelection">
        {{ i18ns.t('relay.selectAllChannels') }}
      </el-checkbox>
      <el-tag v-if="selectedChannelCount" size="small" type="info">
        {{ i18ns.t('relay.selectedChannels', { count: selectedChannelCount }) }}
      </el-tag>
      <el-button text :disabled="!hasChannelSelection" @click="clearChannelSelection">
        {{ i18ns.t('relay.clearChannelSelection') }}
      </el-button>
      <div class="relay-channel-management__batch-actions">
        <el-dropdown :disabled="!hasChannelSelection" @command="handleBatchCommand">
          <el-button size="small">
            {{ i18ns.t('actions') }}<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="copy">{{
                i18ns.t('relay.batchCopyChannels')
              }}</el-dropdown-item>
              <el-dropdown-item command="duplicate">{{
                i18ns.t('relay.batchDuplicateChannels')
              }}</el-dropdown-item>
              <el-dropdown-item command="enable">{{
                i18ns.t('relay.batchEnableChannels')
              }}</el-dropdown-item>
              <el-dropdown-item command="disable">{{
                i18ns.t('relay.batchDisableChannels')
              }}</el-dropdown-item>
              <el-dropdown-item divided command="delete">{{
                i18ns.t('relay.batchDeleteChannels')
              }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div v-if="isDesktop" class="relay-channel-management__table">
      <el-table :data="channelRows" row-key="id" size="small">
        <el-table-column width="52" align="center">
          <template #default="{ row }">
            <el-checkbox
              :model-value="isChannelSelected(row.id)"
              @change="toggleChannelSelection(row.id, $event)"
            />
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelName')" min-width="220">
          <template #default="{ row }"
            ><span class="relay-channel-management__name">{{ row.name }}</span></template
          >
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelType')" width="150">
          <template #default="{ row }"
            ><el-tag size="small">{{ formatChannelTypeLabel(row.channelType) }}</el-tag></template
          >
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.channelMultiplier')" width="112" align="right">
          <template #default="{ row }">
            <span class="relay-channel-management__multiplier">{{ row.multiplier }}x</span>
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('status')" width="96">
          <template #default="{ row }"
            ><el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{
              row.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled')
            }}</el-tag></template
          >
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.visibilityMode')" width="120">
          <template #default="{ row }">{{
            formatVisibilityModeLabel(row.visibilityMode)
          }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.poolMembers')" width="100" align="center">
          <template #default="{ row }">{{
            row.channelType === 'standalone' ? '-' : row.poolMemberCount
          }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('relay.updateTime')" width="170">
          <template #default="{ row }">{{ new Date(row.updateTime).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" width="260" fixed="right">
          <template #default="{ row }">
            <el-button text @click="openChannelDetailDialog(row)">{{
              i18ns.t('button.viewDetails')
            }}</el-button>
            <PermissionWrapper :require="[Permission.RELAY_CHANNEL_UPDATE]">
              <el-button text @click="openEditChannelDialog(row)">{{ i18ns.t('edit') }}</el-button>
            </PermissionWrapper>
            <PermissionWrapper :require="[Permission.RELAY_CHANNEL_UPDATE]">
              <el-button
                text
                :type="row.enabled ? 'warning' : 'success'"
                :loading="togglingChannelId === row.id"
                @click="handleToggleChannelStatus(row)"
              >
                {{ row.enabled ? i18ns.t('relay.disable') : i18ns.t('relay.enable') }}
              </el-button>
            </PermissionWrapper>
            <el-dropdown trigger="click" @command="handleRowCommand($event, row)">
              <el-button text>{{ i18ns.t('nav.more') }}</el-button>
              <template #dropdown
                ><el-dropdown-menu>
                  <el-dropdown-item command="duplicate">{{
                    i18ns.t('relay.duplicateChannel')
                  }}</el-dropdown-item>
                  <el-dropdown-item divided command="delete">{{
                    i18ns.t('delete')
                  }}</el-dropdown-item>
                </el-dropdown-menu></template
              >
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-else class="relay-channel-management__mobile-list">
      <button
        v-for="row in channelRows"
        :key="row.id"
        type="button"
        class="relay-channel-management__mobile-row"
        @click="openChannelDetailDialog(row)"
      >
        <el-checkbox
          :model-value="isChannelSelected(row.id)"
          @click.stop
          @change="toggleChannelSelection(row.id, $event)"
        />
        <span class="relay-channel-management__mobile-name">{{ row.name }}</span>
        <span class="relay-channel-management__mobile-multiplier">{{ row.multiplier }}x</span>
        <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{
          row.enabled ? i18ns.t('relay.enabled') : i18ns.t('relay.disabled')
        }}</el-tag>
        <el-icon><ArrowRight /></el-icon>
      </button>
      <el-empty v-if="!channelRows.length && !channelLoading" />
    </div>

    <el-pagination
      class="relay-channel-management__pagination"
      background
      layout="total, sizes, prev, pager, next"
      :current-page="channelPagination.page"
      :page-size="channelPagination.pageSize"
      :page-sizes="[25, 50, 100]"
      :total="channelPagination.total"
      @update:current-page="updateChannelPagination($event)"
      @update:page-size="updateChannelPagination(undefined, $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { ArrowDown, ArrowRight, Plus, Search } from '@element-plus/icons-vue'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { i18ns } from '@/locales'
import { useRelaySettingsManagementContext } from '../context'

const state = useRelaySettingsManagementContext()
const {
  Permission,
  isDesktop,
  channelLoading,
  channelExporting,
  togglingChannelId,
  channelRows,
  channelFilters,
  channelPagination,
  selectedChannelCount,
  hasChannelSelection,
  isCurrentPageFullySelected,
  isChannelSelected,
  toggleChannelSelection,
  toggleCurrentPageSelection,
  clearChannelSelection,
  setChannelKeyword,
  updateChannelFilters,
  updateChannelPagination,
  formatChannelTypeLabel,
  formatVisibilityModeLabel,
  openCreateChannelDialog,
  openChannelImportDialog,
  exportChannelsAsJson,
  copyChannelsAsJson,
  openChannelDetailDialog,
  openEditChannelDialog,
  handleDuplicateChannel,
  handleToggleChannelStatus,
  handleDeleteChannel,
  handleBatchDuplicateChannels,
  handleBatchSetChannelStatus,
  handleBatchDeleteChannels,
} = state

const handleRowCommand = (command: string, row: (typeof channelRows.value)[number]) => {
  if (command === 'duplicate') void handleDuplicateChannel(row)
  if (command === 'delete') void handleDeleteChannel(row)
}

const handleBatchCommand = (command: string) => {
  if (command === 'copy') void copyChannelsAsJson()
  if (command === 'duplicate') void handleBatchDuplicateChannels()
  if (command === 'enable') void handleBatchSetChannelStatus(true)
  if (command === 'disable') void handleBatchSetChannelStatus(false)
  if (command === 'delete') void handleBatchDeleteChannels()
}
</script>
