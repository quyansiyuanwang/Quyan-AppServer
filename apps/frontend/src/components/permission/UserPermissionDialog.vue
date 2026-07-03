<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    :title="i18ns.t('UserPermissionDialog.title')"
    width="1000px"
    :close-on-click-modal="false"
  >
    <div v-if="user && userPermissions" v-loading="loading">
      <!-- 用户信息头部 -->
      <div class="user-info-header">
        <div class="user-avatar">
          {{ (user.name || user.username || '?').charAt(0).toUpperCase() }}
        </div>
        <div class="user-details">
          <div class="user-name">
            {{ user.username }}
            <span v-if="user.name" class="user-display-name">({{ user.name }})</span>
          </div>
          <div class="user-stats">
            <el-tooltip :content="i18ns.t('UserPermissionDialog.statGroupTotal')" placement="top">
              <el-tag type="primary" size="small" effect="plain">
                {{ i18ns.t('UserPermissionDialog.statGroupTotal') }}: {{ groupPermsCount }}
              </el-tag>
            </el-tooltip>
            <el-tooltip :content="i18ns.t('UserPermissionDialog.statCustomAdded')" placement="top">
              <el-tag type="success" size="small" effect="plain"> +{{ customAddedCount }} </el-tag>
            </el-tooltip>
            <el-tooltip :content="i18ns.t('UserPermissionDialog.statGroupRemoved')" placement="top">
              <el-tag type="warning" size="small" effect="plain"> -{{ groupRemovedCount }} </el-tag>
            </el-tooltip>
            <el-tag type="info" size="small" effect="dark">
              {{ i18ns.t('UserPermissionDialog.statEffective') }}: {{ effectivePermissions.length }}
            </el-tag>
          </div>
        </div>
      </div>

      <!-- 穿梭框 -->
      <div class="permission-section">
        <PermissionTransfer
          v-model="effectivePermissions"
          :all-permissions="allPermissionsTyped"
          :disabled-permissions="userPermissions.groupPermissions"
        />
      </div>
    </div>

    <template #footer>
      <div style="display: flex; justify-content: space-between; width: 100%">
        <el-button
          type="danger"
          plain
          @click="handleClearCustomPermissions"
          :disabled="!hasCustomPermissions"
        >
          {{ i18ns.t('UserPermissionDialog.clearCustomPermissions') }}
        </el-button>
        <div>
          <el-button @click="handleCancel">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" @click="handleSave" :loading="saving">{{
            i18ns.t('save')
          }}</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UserDto, UserFullPermissionsDto, Permission } from '@/client/types.gen'
import { usePermissionStore } from '@/stores/permissionStore'
import PermissionTransfer from './PermissionTransfer.vue'
import { i18ns } from '@/locales'

interface Props {
  modelValue: boolean
  user: UserDto | null
  userPermissions: UserFullPermissionsDto | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: []
}>()

const permissionStore = usePermissionStore()

const loading = ref(false)
const saving = ref(false)

// 用户的有效权限（组权限 + 额外添加 - 移除的）
const effectivePermissions = ref<Permission[]>([])

// 转换权限列表为正确的类型
const allPermissionsTyped = computed(() => {
  return permissionStore.allPermissions.map(
    (perm: { category: string; name: string; value: string }) => ({
      category: perm.category,
      name: perm.name,
      value: perm.value as Permission,
    }),
  )
})

// 检查是否有自定义权限
const hasCustomPermissions = computed(() => {
  if (!props.userPermissions) return false
  return (
    (props.userPermissions.additionalPermissions?.length || 0) > 0 ||
    (props.userPermissions.removedPermissions?.length || 0) > 0
  )
})

// 监听对话框打开，初始化有效权限
watch(
  () => props.modelValue,
  (visible) => {
    if (visible && props.userPermissions) {
      // 计算用户当前的有效权限：组权限 + 额外添加 - 移除的
      const groupPerms = new Set(props.userPermissions.groupPermissions || [])
      const addPerms = props.userPermissions.additionalPermissions || []
      const removePerms = new Set(props.userPermissions.removedPermissions || [])

      const effective = new Set([...groupPerms, ...addPerms])
      removePerms.forEach((perm) => effective.delete(perm))

      effectivePermissions.value = Array.from(effective)
    }
  },
)

// 计算统计数据（实时响应编辑）
const groupPermsCount = computed(() => props.userPermissions?.groupPermissions?.length ?? 0)
const groupPermsSet = computed(() => new Set(props.userPermissions?.groupPermissions ?? []))
const customAddedCount = computed(
  () => effectivePermissions.value.filter((p) => !groupPermsSet.value.has(p)).length,
)
const groupRemovedCount = computed(
  () =>
    (props.userPermissions?.groupPermissions ?? []).filter(
      (p) => !effectivePermissions.value.includes(p),
    ).length,
)

// 清除自定义权限
const handleClearCustomPermissions = async () => {
  if (!props.user?.id || !props.userPermissions) return

  try {
    await ElMessageBox.confirm(
      i18ns.t('UserPermissionDialog.clearConfirmMessage', { username: props.user.username }),
      i18ns.t('UserPermissionDialog.clearConfirmTitle'),
      {
        confirmButtonText: i18ns.t('UserPermissionDialog.confirmButton'),
        cancelButtonText: i18ns.t('UserPermissionDialog.cancelButton'),
        type: 'warning',
      },
    )

    const success = await permissionStore.clearUserPermissions(props.user.id)
    if (success) {
      ElMessage.success(i18ns.t('PermissionManagement.clearCustomSuccess'))
      emit('success')
      handleCancel()
    } else {
      ElMessage.error(i18ns.t('PermissionManagement.clearCustomFailed'))
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(i18ns.t('PermissionManagement.clearCustomFailed'))
      console.error(error)
    }
  }
}

// 保存
const handleSave = async () => {
  if (!props.user?.id || !props.userPermissions) return

  try {
    saving.value = true

    // 计算需要添加和移除的权限
    const groupPermsSet = new Set(props.userPermissions.groupPermissions || [])
    const effectivePermsSet = new Set(effectivePermissions.value)

    // 额外添加的权限：在有效权限中但不在组权限中
    const additionalPermissions = effectivePermissions.value.filter(
      (perm: Permission) => !groupPermsSet.has(perm),
    )

    // 要移除的权限：在组权限中但不在有效权限中
    const removedPermissions = (props.userPermissions.groupPermissions || []).filter(
      (perm: Permission) => !effectivePermsSet.has(perm),
    )

    // 完整设置用户权限
    const success = await permissionStore.setUserPermissions(
      props.user.id,
      additionalPermissions,
      removedPermissions,
    )

    if (success) {
      ElMessage.success(i18ns.t('message.information.saveSuccess'))
      emit('success')
      handleCancel()
    } else {
      ElMessage.error(i18ns.t('message.information.saveFailed'))
    }
  } catch (error) {
    console.error('保存权限失败:', error)
    ElMessage.error(i18ns.t('message.information.saveFailed'))
  } finally {
    saving.value = false
  }
}

// 取消
const handleCancel = () => {
  emit('update:modelValue', false)
}
</script>

<style scoped lang="scss">
.user-info-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  margin-bottom: 20px;
  background-color: var(--el-fill-color-lighter);
  border-radius: 8px;

  .user-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--el-color-primary), var(--el-color-primary-light-3));
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .user-details {
    .user-name {
      font-size: 16px;
      font-weight: 600;
      color: var(--el-text-color-primary);
      margin-bottom: 6px;

      .user-display-name {
        font-weight: 400;
        color: var(--el-text-color-secondary);
        font-size: 14px;
      }
    }

    .user-stats {
      display: flex;
      gap: 8px;
    }
  }
}

.permission-section {
  .section-title {
    margin: 0 0 12px 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }
}
</style>
