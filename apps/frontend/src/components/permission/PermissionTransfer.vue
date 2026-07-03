<template>
  <div class="permission-transfer">
    <div class="transfer-tip">
      <el-icon><InfoFilled /></el-icon>
      <span>{{ i18ns.t('UserPermissionDialog.canAddOrRemove') }}</span>
    </div>

    <el-transfer
      v-model="selectedValues"
      :data="transferData"
      :titles="[
        i18ns.t('UserPermissionDialog.leftPanelTitle'),
        i18ns.t('UserPermissionDialog.rightPanelTitle'),
      ]"
      :button-texts="[]"
      :filter-method="filterMethod"
      filterable
      :filter-placeholder="i18ns.t('PermissionSelector.searchPlaceholder')"
      :props="{ key: 'value', label: 'label', disabled: 'disabled' }"
    >
      <template #default="{ option }">
        <div class="permission-item" :class="getItemClass(option)" @click="handleItemClick(option)">
          <el-icon v-if="option.disabled && isInRight(option.value)" class="lock-icon">
            <Lock />
          </el-icon>
          <span class="permission-name">{{ getPermissionDisplayName(option.value) }}</span>
          <el-tag size="small" :type="getTagType(option)" effect="light" style="flex-shrink: 0">
            {{ getTagText(option) }}
          </el-tag>
        </div>
      </template>
    </el-transfer>

    <!-- 四项统计 -->
    <div class="permission-stats">
      <div class="stat-item stat-group">
        <span class="stat-value">{{ groupTotal }}</span>
        <span class="stat-label">{{ i18ns.t('UserPermissionDialog.statGroupTotal') }}</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item stat-added">
        <span class="stat-value">+{{ customAdded }}</span>
        <span class="stat-label">{{ i18ns.t('UserPermissionDialog.statCustomAdded') }}</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item stat-removed">
        <span class="stat-value">-{{ groupRemoved }}</span>
        <span class="stat-label">{{ i18ns.t('UserPermissionDialog.statGroupRemoved') }}</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item stat-effective">
        <span class="stat-value">{{ effectiveTotal }}</span>
        <span class="stat-label">{{ i18ns.t('UserPermissionDialog.statEffective') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { InfoFilled, Lock } from '@element-plus/icons-vue'
import type { Permission } from '@/client/types.gen'
import { getPermissionDisplayName } from '@/constant/permission'
import { i18ns } from '@/locales'

interface PermissionItem {
  category: string
  name: string
  value: Permission
}

interface TransferDataItem {
  value: Permission
  label: string
  name: string
  category: string
  disabled: boolean
}

interface Props {
  modelValue: Permission[]
  allPermissions: PermissionItem[]
  disabledPermissions?: Permission[]
  title?: string
}

const props = withDefaults(defineProps<Props>(), {
  disabledPermissions: () => [],
  title: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: Permission[]]
}>()

const selectedValues = computed({
  get: () => props.modelValue,
  set: (value: Permission[]) => emit('update:modelValue', value),
})

const disabledSet = computed(() => new Set(props.disabledPermissions))

const transferData = computed<TransferDataItem[]>(() =>
  props.allPermissions.map((perm) => ({
    value: perm.value,
    label: `${perm.name} (${perm.value})`,
    name: perm.name,
    category: perm.category,
    disabled: disabledSet.value.has(perm.value),
  })),
)

// 统计
const groupTotal = computed(() => props.disabledPermissions.length)
const customAdded = computed(
  () => selectedValues.value.filter((v) => !disabledSet.value.has(v)).length,
)
const groupRemoved = computed(
  () => props.disabledPermissions.filter((v) => !selectedValues.value.includes(v)).length,
)
const effectiveTotal = computed(() => selectedValues.value.length)

const isInRight = (value: Permission) => selectedValues.value.includes(value)

// 标签类型：右侧组权限=primary，右侧自定义=success，左侧组权限（已移除）=warning，左侧普通=info
const getTagType = (option: TransferDataItem) => {
  const inRight = isInRight(option.value)
  if (inRight && option.disabled) return 'primary'
  if (inRight && !option.disabled) return 'success'
  if (!inRight && option.disabled) return 'warning'
  return 'info'
}

const getTagText = (option: TransferDataItem) => {
  const inRight = isInRight(option.value)
  if (inRight && option.disabled) return i18ns.t('UserPermissionDialog.groupTag')
  if (inRight && !option.disabled) return i18ns.t('UserPermissionDialog.customTag')
  if (!inRight && option.disabled) return i18ns.t('UserPermissionDialog.removedTag')
  return option.category
}

const getItemClass = (option: TransferDataItem) => ({
  'is-group-locked': option.disabled && isInRight(option.value),
  'is-group-removed': option.disabled && !isInRight(option.value),
  'is-custom': !option.disabled && isInRight(option.value),
})

const filterMethod = (query: string, item: TransferDataItem): boolean => {
  if (!query) return true
  const keyword = query.toLowerCase()
  return (
    item.name.toLowerCase().includes(keyword) ||
    item.value.toLowerCase().includes(keyword) ||
    item.category.toLowerCase().includes(keyword)
  )
}

const handleItemClick = (option: TransferDataItem) => {
  if (option.disabled && isInRight(option.value)) return
  if (isInRight(option.value)) {
    selectedValues.value = selectedValues.value.filter((v) => v !== option.value)
  } else {
    selectedValues.value = [...selectedValues.value, option.value]
  }
}
</script>

<style scoped lang="scss">
.permission-transfer {
  .transfer-tip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    margin-bottom: 16px;
    background-color: var(--el-color-primary-light-9);
    border-left: 3px solid var(--el-color-primary);
    border-radius: 4px;
    font-size: 13px;
    color: var(--el-text-color-regular);

    .el-icon {
      color: var(--el-color-primary);
      font-size: 15px;
      flex-shrink: 0;
    }
  }

  :deep(.el-transfer) {
    display: flex;
    justify-content: center;
    align-items: flex-start;

    .el-transfer__buttons {
      display: none;
    }

    .el-transfer-panel {
      width: 370px;

      .el-checkbox {
        display: none;
      }

      .el-transfer-panel__item {
        padding-left: 12px;
      }
    }

    .permission-item {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      cursor: pointer;
      padding: 3px 6px;
      margin: -3px -6px;
      border-radius: 4px;
      transition: background-color 0.15s;

      &:hover {
        background-color: var(--el-fill-color-light);
      }

      &.is-group-locked {
        cursor: not-allowed;
      }

      &.is-group-removed {
        .permission-name {
          color: var(--el-color-warning);
        }
      }

      &.is-custom {
        .permission-name {
          color: var(--el-color-success);
        }
      }

      .lock-icon {
        color: var(--el-text-color-placeholder);
        font-size: 12px;
        flex-shrink: 0;
      }

      .permission-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
      }
    }
  }

  .permission-stats {
    display: flex;
    align-items: center;
    gap: 0;
    margin-top: 16px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    overflow: hidden;

    .stat-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 12px 8px;

      .stat-value {
        font-size: 22px;
        font-weight: 700;
        line-height: 1.2;
      }

      .stat-label {
        font-size: 12px;
        color: var(--el-text-color-secondary);
        margin-top: 3px;
        white-space: nowrap;
      }

      &.stat-group .stat-value {
        color: var(--el-color-primary);
      }
      &.stat-added .stat-value {
        color: var(--el-color-success);
      }
      &.stat-removed .stat-value {
        color: var(--el-color-warning);
      }
      &.stat-effective .stat-value {
        color: var(--el-text-color-primary);
      }
    }

    .stat-divider {
      width: 1px;
      height: 40px;
      background-color: var(--el-border-color-lighter);
      flex-shrink: 0;
    }
  }
}
</style>
