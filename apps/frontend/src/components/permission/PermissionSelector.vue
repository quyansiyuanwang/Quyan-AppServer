<template>
  <div class="permission-selector">
    <div class="selector-header">
      <h4 v-if="title">{{ title }}</h4>
      <div class="selector-actions">
        <el-input
          v-model="searchKeyword"
          :placeholder="i18ns.t('PermissionSelector.searchPlaceholder')"
          :prefix-icon="Search"
          clearable
          style="width: 300px"
        />
        <el-button @click="handleSelectAll">{{
          i18ns.t('PermissionSelector.selectAll')
        }}</el-button>
        <el-button @click="handleClearAll">{{ i18ns.t('PermissionSelector.clearAll') }}</el-button>
      </div>
    </div>

    <el-divider style="margin: 12px 0" />

    <!-- 按分类展示权限复选框 -->
    <div class="permission-categories">
      <div v-for="category in filteredCategories" :key="category" class="category-group">
        <div class="category-header">
          <el-checkbox
            :model-value="isCategoryFullySelected(category)"
            :indeterminate="isCategoryPartiallySelected(category)"
            @change="handleCategoryToggle(category, $event)"
          >
            <span class="category-name">{{ getCategoryLabel(category) }}</span>
            <el-tag size="small" type="info" style="margin-left: 8px">
              {{ getSelectedCountInCategory(category) }} /
              {{ getCategoryPermissions(category).length }}
            </el-tag>
          </el-checkbox>
        </div>

        <div class="permission-items">
          <el-checkbox-group v-model="selectedPermissions">
            <el-checkbox
              v-for="perm in getCategoryPermissions(category)"
              :key="perm.value"
              :label="perm.value"
              :disabled="isPermissionDisabled(perm.value)"
              class="permission-checkbox"
            >
              <span class="permission-label">{{
                getPermissionLabel(perm.value, i18ns.locale)
              }}</span>
              <span class="permission-value">({{ perm.value }})</span>
            </el-checkbox>
          </el-checkbox-group>
        </div>
      </div>
    </div>

    <el-empty
      v-if="filteredCategories.length === 0"
      :description="i18ns.t('PermissionSelector.noMatchingPermissions')"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import type { Permission } from '@/client/types.gen'
import { getPermissionLabel } from '@/constant/permission'
import { i18ns } from '@/locales'
import {
  getPermissionCategoryId,
  getPermissionCategoryTranslationKey,
} from '@/views/management/permission-tree'

interface PermissionItem {
  category: string
  name: string
  value: Permission
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

const searchKeyword = ref('')
const selectedPermissions = ref<Permission[]>([...props.modelValue])

// 同步 modelValue 变化
watch(
  () => props.modelValue,
  (newVal) => {
    selectedPermissions.value = [...newVal]
  },
)

// 同步选中状态到父组件
watch(
  selectedPermissions,
  (newVal) => {
    emit('update:modelValue', newVal)
  },
  { deep: true },
)

// 获取所有分类
const allCategories = computed(() => {
  const categorySet = new Set<string>()
  props.allPermissions.forEach((perm) => categorySet.add(getPermissionCategoryId(perm.value)))
  return Array.from(categorySet).sort()
})

// 根据搜索过滤分类
const filteredCategories = computed(() => {
  if (!searchKeyword.value) return allCategories.value

  const keyword = searchKeyword.value.toLowerCase()
  return allCategories.value.filter((category) => {
    const categoryPerms = props.allPermissions.filter(
      (permission) => getPermissionCategoryId(permission.value) === category,
    )
    return categoryPerms.some(
      (permission) =>
        getPermissionLabel(permission.value, i18ns.locale).toLowerCase().includes(keyword) ||
        permission.value.toLowerCase().includes(keyword) ||
        getCategoryLabel(category).toLowerCase().includes(keyword),
    )
  })
})

// 获取分类下的权限
const getCategoryPermissions = (category: string) => {
  const perms = props.allPermissions.filter(
    (permission) => getPermissionCategoryId(permission.value) === category,
  )

  // 如果有搜索关键词，过滤权限
  if (!searchKeyword.value) return perms

  const keyword = searchKeyword.value.toLowerCase()
  return perms.filter(
    (permission) =>
      getPermissionLabel(permission.value, i18ns.locale).toLowerCase().includes(keyword) ||
      permission.value.toLowerCase().includes(keyword),
  )
}

const getCategoryLabel = (category: string) =>
  i18ns.t(getPermissionCategoryTranslationKey(category, 'label'))

// 检查权限是否被禁用
const isPermissionDisabled = (permission: Permission) => {
  return props.disabledPermissions.includes(permission)
}

// 检查分类是否全选
const isCategoryFullySelected = (category: string) => {
  const categoryPerms = getCategoryPermissions(category)
  const selectablePerms = categoryPerms.filter((p) => !isPermissionDisabled(p.value))
  if (selectablePerms.length === 0) return false
  return selectablePerms.every((perm) => selectedPermissions.value.includes(perm.value))
}

// 检查分类是否部分选中
const isCategoryPartiallySelected = (category: string) => {
  const categoryPerms = getCategoryPermissions(category)
  const selectablePerms = categoryPerms.filter((p) => !isPermissionDisabled(p.value))
  if (selectablePerms.length === 0) return false

  const selectedCount = selectablePerms.filter((perm) =>
    selectedPermissions.value.includes(perm.value),
  ).length

  return selectedCount > 0 && selectedCount < selectablePerms.length
}

// 获取分类中已选数量
const getSelectedCountInCategory = (category: string) => {
  const categoryPerms = getCategoryPermissions(category)
  return categoryPerms.filter((perm) => selectedPermissions.value.includes(perm.value)).length
}

// 切换分类选中状态
const handleCategoryToggle = (category: string, checked: boolean | string | number) => {
  const categoryPerms = getCategoryPermissions(category)
  const selectablePerms = categoryPerms.filter((p) => !isPermissionDisabled(p.value))

  if (checked) {
    // 添加该分类下所有未禁用的权限
    const permsToAdd = selectablePerms
      .map((p) => p.value)
      .filter((p) => !selectedPermissions.value.includes(p))
    selectedPermissions.value = [...selectedPermissions.value, ...permsToAdd]
  } else {
    // 移除该分类下所有权限
    const permsToRemove = new Set(selectablePerms.map((p) => p.value))
    selectedPermissions.value = selectedPermissions.value.filter(
      (p: Permission) => !permsToRemove.has(p),
    )
  }
}

// 全选
const handleSelectAll = () => {
  const allSelectablePerms = props.allPermissions
    .filter((p) => !isPermissionDisabled(p.value))
    .map((p) => p.value)
  selectedPermissions.value = Array.from(
    new Set([...selectedPermissions.value, ...allSelectablePerms]),
  )
}

// 清空
const handleClearAll = () => {
  selectedPermissions.value = []
}
</script>

<style scoped lang="scss">
.permission-selector {
  .selector-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;

    h4 {
      margin: 0;
      font-size: 16px;
    }

    .selector-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
  }

  .permission-categories {
    .category-group {
      margin-bottom: 20px;
      border: 1px solid var(--el-border-color-light);
      border-radius: 4px;
      padding: 12px;
      background-color: var(--el-fill-color-blank);

      &:last-child {
        margin-bottom: 0;
      }

      .category-header {
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--el-border-color-lighter);

        .category-name {
          font-weight: 600;
          font-size: 14px;
        }
      }

      .permission-items {
        :deep(.el-checkbox-group) {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 8px;
        }

        .permission-checkbox {
          margin-right: 0 !important;

          :deep(.el-checkbox__label) {
            display: flex;
            align-items: center;
            flex-wrap: nowrap;

            .permission-label {
              flex-shrink: 0;
            }

            .permission-value {
              margin-left: 4px;
              font-size: 12px;
              color: var(--el-text-color-secondary);
              font-family: monospace;
              flex-shrink: 0;
            }
          }
        }
      }
    }
  }
}
</style>
