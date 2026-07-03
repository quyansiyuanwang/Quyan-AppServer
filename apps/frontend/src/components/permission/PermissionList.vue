<template>
  <div class="permission-list">
    <template v-if="permissions.length === 0">
      <el-empty :description="i18ns.t('permissionText.noPermissions')" />
    </template>
    <template v-else>
      <!-- 按分类显示 -->
      <div v-for="category in categories" :key="category" class="permission-category">
        <h4 class="category-title">{{ category }}</h4>
        <div class="permission-tags">
          <el-tag
            v-for="perm in getPermissionsByCategory(category)"
            :key="perm"
            :type="tagType"
            :effect="tagEffect"
            class="permission-tag"
          >
            <el-icon v-if="showIcon" style="margin-right: 4px">
              <Lock />
            </el-icon>
            {{ getPermissionDisplayName(perm) }}
            <span class="permission-value">({{ perm }})</span>
          </el-tag>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Lock } from '@element-plus/icons-vue'
import type { Permission } from '@/client/types.gen'
import { getPermissionCategory, getPermissionDisplayName } from '@/constant/permission'
import { i18ns } from '@/locales'

interface Props {
  permissions: Permission[]
  tagType?: 'primary' | 'success' | 'info' | 'warning' | 'danger'
  tagEffect?: 'light' | 'dark' | 'plain'
  showIcon?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  tagType: undefined,
  tagEffect: 'light',
  showIcon: true,
})

// 获取所有分类
const categories = computed(() => {
  const categorySet = new Set<string>()
  props.permissions.forEach((perm) => {
    categorySet.add(getPermissionCategory(perm))
  })
  return Array.from(categorySet).sort()
})

// 根据分类获取权限
const getPermissionsByCategory = (category: string) => {
  return props.permissions.filter((perm) => getPermissionCategory(perm) === category)
}
</script>

<style scoped lang="scss">
.permission-list {
  .permission-category {
    margin-bottom: 20px;

    &:last-child {
      margin-bottom: 0;
    }

    .category-title {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--el-text-color-primary);
      border-bottom: 1px solid var(--el-border-color-lighter);
      padding-bottom: 8px;
    }

    .permission-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;

      .permission-tag {
        display: inline-flex;
        align-items: center;

        .permission-value {
          margin-left: 4px;
          font-size: 12px;
          opacity: 0.7;
          font-family: monospace;
        }
      }
    }
  }
}
</style>
