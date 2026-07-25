import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { i18ns } from '@/locales'
import { usePageDevice } from '@/composables/usePageDevice'
import { groupService } from '@/service/groupService'
import { usePermissionStore } from '@/stores/permissionStore'
import { Permission, ALL_PERMISSIONS } from '@/constant/permission'
import { buildGrantablePermissionTree } from '../permission-tree'

export interface GroupItem {
  id: string
  username: string
  name?: string | null
  permissions: string[]
  level: number
  description?: string | null
}

export const useGroupManagement = () => {
  const { isDesktop } = usePageDevice()
  const permissionStore = usePermissionStore()

  const groupList = ref<GroupItem[]>([])
  const loading = ref(false)
  const dialogVisible = ref(false)
  const isEdit = ref(false)
  const submitting = ref(false)
  const editingGroupId = ref('')
  const formRef = ref<FormInstance>()

  const keyword = ref('')
  const showRamGroups = ref(false)
  const pagination = ref({ page: 1, pageSize: 10, total: 0 })
  const displayTotal = computed(() => pagination.value.total)

  const permDialogVisible = ref(false)
  const permSaving = ref(false)
  const editingPermGroupId = ref('')
  const selectedPermissions = ref<string[]>([])
  const originalPermissions = ref<string[]>([])
  const permissionTree = computed(() =>
    buildGrantablePermissionTree({
      allPermissions: ALL_PERMISSIONS,
      effectivePermissions: ALL_PERMISSIONS,
      locale: String(i18ns.refer.value),
      translateCategory: (key) => i18ns.t(key),
    }),
  )

  const canAddGroupPermissions = computed(() =>
    permissionStore.hasPermission(Permission.GROUP_PERMISSION_ADD),
  )
  const canRemoveGroupPermissions = computed(() =>
    permissionStore.hasPermission(Permission.GROUP_PERMISSION_REMOVE),
  )
  const permissionChanges = computed(() => {
    const original = new Set(originalPermissions.value)
    const selected = new Set(selectedPermissions.value)
    return {
      added: selectedPermissions.value.filter((permission) => !original.has(permission)),
      removed: originalPermissions.value.filter((permission) => !selected.has(permission)),
    }
  })
  const canSavePermissions = computed(
    () =>
      (permissionChanges.value.added.length === 0 || canAddGroupPermissions.value) &&
      (permissionChanges.value.removed.length === 0 || canRemoveGroupPermissions.value) &&
      (permissionChanges.value.added.length > 0 || permissionChanges.value.removed.length > 0),
  )
  const isPermissionDisabled = (permission: string) =>
    selectedPermissions.value.includes(permission)
      ? !canRemoveGroupPermissions.value
      : !canAddGroupPermissions.value

  const formData = reactive({
    username: '',
    name: '',
    level: 50,
    description: '',
  })

  const formRules = reactive<FormRules>({
    username: [
      {
        required: true,
        message: () => i18ns.t('GroupManagement.usernameRequired'),
        trigger: 'blur',
      },
    ],
    level: [
      {
        required: true,
        message: () => i18ns.t('GroupManagement.levelRequired'),
        trigger: 'blur',
      },
    ],
  })

  const loadGroups = async () => {
    loading.value = true
    try {
      const response = await groupService.getAllGroups({
        keyword: keyword.value || undefined,
        page: pagination.value.page,
        pageSize: pagination.value.pageSize,
        hasRamPermission: showRamGroups.value || undefined,
      })
      groupList.value = response.groups
      pagination.value.total = response.total
    } catch (error) {
      ElMessage.error(i18ns.t('GroupManagement.loadFailed'))
      console.error('Failed to load groups:', error)
    } finally {
      loading.value = false
    }
  }

  const handleCreate = () => {
    isEdit.value = false
    dialogVisible.value = true
  }

  const handleEdit = (row: GroupItem) => {
    isEdit.value = true
    editingGroupId.value = row.id
    formData.name = row.name || ''
    formData.level = row.level
    formData.description = row.description || ''
    dialogVisible.value = true
  }

  const handleDelete = async (row: GroupItem) => {
    try {
      await ElMessageBox.confirm(
        i18ns.t('GroupManagement.deleteConfirm', { username: row.username }),
        i18ns.t('GroupManagement.deleteConfirmTitle'),
        { type: 'warning', confirmButtonClass: 'el-button--danger' },
      )
      await groupService.deleteGroup(row.id)
      ElMessage.success(i18ns.t('message.information.deleteSuccess'))
      void loadGroups()
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(i18ns.t('GroupManagement.deleteFailed'))
      }
    }
  }

  const handleEditPermissions = async (row: GroupItem) => {
    editingPermGroupId.value = row.id
    try {
      const permissions = (await groupService.getGroupPermissions(row.id)).permissions
      selectedPermissions.value = [...permissions]
      originalPermissions.value = [...permissions]
      permDialogVisible.value = true
    } catch (_error) {
      ElMessage.error(i18ns.t('GroupManagement.permissionLoadFailed'))
    }
  }

  const handleSavePermissions = async () => {
    if (!canSavePermissions.value) return
    permSaving.value = true
    try {
      await groupService.setGroupPermissions(
        editingPermGroupId.value,
        selectedPermissions.value as Permission[],
      )
      ElMessage.success(i18ns.t('message.information.saveSuccess'))
      permDialogVisible.value = false
      await loadGroups()
    } catch (_error) {
      ElMessage.error(i18ns.t('GroupManagement.permissionSaveFailed'))
    } finally {
      permSaving.value = false
    }
  }

  const resetPermissionDialog = () => {
    editingPermGroupId.value = ''
    selectedPermissions.value = []
    originalPermissions.value = []
  }

  const handleSubmit = async () => {
    if (!formRef.value) {
      return
    }
    const valid = await formRef.value.validate().catch(() => false)
    if (!valid) {
      return
    }

    submitting.value = true
    try {
      if (isEdit.value) {
        await groupService.updateGroup(editingGroupId.value, {
          name: formData.name || undefined,
          level: formData.level,
          description: formData.description || undefined,
        })
        ElMessage.success(i18ns.t('message.information.editSuccess'))
      } else {
        await groupService.createGroup({
          username: formData.username,
          name: formData.name || undefined,
          level: formData.level,
          description: formData.description || undefined,
        })
        ElMessage.success(i18ns.t('message.information.createSuccess'))
      }
      dialogVisible.value = false
      void loadGroups()
    } catch (error) {
      ElMessage.error(
        isEdit.value
          ? i18ns.t('GroupManagement.updateFailed')
          : i18ns.t('GroupManagement.createFailed'),
      )
      throw error
    } finally {
      submitting.value = false
    }
  }

  const resetForm = () => {
    formData.username = ''
    formData.name = ''
    formData.level = 50
    formData.description = ''
    editingGroupId.value = ''
    formRef.value?.resetFields()
  }

  const handleRefresh = () => {
    keyword.value = ''
    showRamGroups.value = false
    pagination.value.page = 1
    void loadGroups()
  }

  const handleSearch = () => {
    pagination.value.page = 1
    void loadGroups()
  }

  const handlePageChange = () => {
    void loadGroups()
  }

  const handlePageSizeChange = () => {
    pagination.value.page = 1
    void loadGroups()
  }

  onMounted(() => {
    void loadGroups()
  })

  return {
    isDesktop,
    groupList,
    loading,
    dialogVisible,
    isEdit,
    submitting,
    editingGroupId,
    formRef,
    keyword,
    showRamGroups,
    pagination,
    displayTotal,
    permDialogVisible,
    permSaving,
    editingPermGroupId,
    selectedPermissions,
    originalPermissions,
    permissionTree,
    formData,
    formRules,
    canAddGroupPermissions,
    canRemoveGroupPermissions,
    canSavePermissions,
    isPermissionDisabled,
    loadGroups,
    handleCreate,
    handleEdit,
    handleDelete,
    handleEditPermissions,
    handleSavePermissions,
    resetPermissionDialog,
    handleSubmit,
    resetForm,
    handleRefresh,
    handleSearch,
    handlePageChange,
    handlePageSizeChange,
    ALL_PERMISSIONS,
    Permission,
  }
}

export type GroupManagementState = ReturnType<typeof useGroupManagement>
