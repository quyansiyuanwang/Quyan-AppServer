import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { getPermissionLabel, getPermissionTooltip } from '@/constant/permission'
import { Permission } from '@/constant/permission'
import type {
  EffectivePermissionDto,
  GroupDto,
  Permission as ClientPermission,
  RamPolicyAttachmentDto,
  RamPolicyDto,
  RamRoleBindingDto,
  RamRoleDto,
  RamRoleSessionDto,
  RamUserDto,
} from '@/client/types.gen'
import { i18ns } from '@/locales'
import { ramService } from '@/service/ramService'
import { usePermissionStore } from '@/stores/permissionStore'
import { buildGrantablePermissionTree, filterGrantablePermissions } from '../ram-permission-tree'

export function useRamManagement() {
  const activeTab = ref('users')
  const permissionStore = usePermissionStore()
  const users = ref<RamUserDto[]>([])
  const roles = ref<RamRoleDto[]>([])
  const bindings = ref<RamRoleBindingDto[]>([])
  const sessions = ref<RamRoleSessionDto[]>([])
  const groups = ref<GroupDto[]>([])
  const selectedRoleId = ref('')
  const selectedRole = ref<RamRoleDto | null>(null)
  const submitting = ref(false)
  const loading = reactive({
    users: false,
    roles: false,
    bindings: false,
    sessions: false,
    policies: false,
    attachments: false,
  })

  const userDialogVisible = ref(false)
  const roleDialogVisible = ref(false)
  const bindDialogVisible = ref(false)
  const policyDialogVisible = ref(false)
  const attachDrawerVisible = ref(false)
  const showAttachForm = ref(false)
  const editingUser = ref<RamUserDto | null>(null)
  const editingRole = ref<RamRoleDto | null>(null)
  const editingPolicy = ref<RamPolicyDto | null>(null)
  const selectedPolicy = ref<RamPolicyDto | null>(null)
  const accessKeyDialogVisible = ref(false)
  const createdAccessKeySecret = ref('')
  const createdAccessKeyName = ref('')
  const passwordDialogVisible = ref(false)
  const createdPasswordValue = ref('')
  const createdPasswordUsername = ref('')
  const bindRole = ref<RamRoleDto | null>(null)
  const bindMode = ref<'user' | 'group'>('user')
  const bindTargetId = ref('')
  const userFormRef = ref<FormInstance>()
  const roleFormRef = ref<FormInstance>()
  const policyFormRef = ref<FormInstance>()
  const policyPermTreeRef = ref<any>()

  const userSearch = ref('')
  const roleSearch = ref('')
  const policySearch = ref('')
  const selectedUsers = ref<RamUserDto[]>([])
  const selectedRoles = ref<RamRoleDto[]>([])

  const policies = ref<RamPolicyDto[]>([])
  const policyAttachments = ref<RamPolicyAttachmentDto[]>([])
  const authUserId = ref('')
  const effectivePerms = ref<EffectivePermissionDto | null>(null)
  const attachForm = reactive({ targetType: 'user' as 'user' | 'role' | 'group', targetId: '' })

  const userForm = reactive({
    username: '',
    password: '',
    ramUsername: '',
    displayName: '',
    email: '',
    status: 1,
    groupId: '',
    accessTypes: ['console'],
    passwordMode: 'auto',
    passwordResetRequired: false,
    accessKeyName: '',
  })

  const roleForm = reactive({
    name: '',
    description: '',
    maxSessionDuration: 3600,
  })

  const policyForm = reactive({ name: '', description: '', permissions: [] as string[] })
  const grantablePermissions = computed(() => new Set<string>(permissionStore.effectivePermissions))

  const permissionTree = computed(() =>
    buildGrantablePermissionTree({
      effectivePermissions: grantablePermissions.value,
      locale: i18ns.refer.value as string,
      translateCategory: (key) => i18ns.t(key as any),
    }),
  )

  const filteredUsers = computed(() => {
    const q = userSearch.value.toLowerCase()
    if (!q) return users.value
    return users.value.filter((user) =>
      [user.username, user.ramUsername, user.displayName, user.email].some((value) =>
        value?.toLowerCase().includes(q),
      ),
    )
  })

  const filteredRoles = computed(() => {
    const q = roleSearch.value.toLowerCase()
    if (!q) return roles.value
    return roles.value.filter((role) =>
      [role.name, role.description].some((value) => value?.toLowerCase().includes(q)),
    )
  })

  const filteredPolicies = computed(() => {
    const q = policySearch.value.toLowerCase()
    if (!q) return policies.value
    return policies.value.filter((policy) =>
      [policy.name, policy.description].some((value) => value?.toLowerCase().includes(q)),
    )
  })

  const attachTargetOptions = computed(() => {
    if (attachForm.targetType === 'user') {
      return users.value.map((user) => ({
        id: user.id,
        label: user.displayName || user.ramUsername || user.username,
      }))
    }

    if (attachForm.targetType === 'role') {
      return roles.value.map((role) => ({ id: role.id, label: role.name }))
    }

    return groups.value.map((group) => ({ id: group.id, label: group.name || group.username }))
  })

  const permissionBreakdownSource = computed(() => {
    if (!effectivePerms.value) return []

    return [
      {
        source: i18ns.t('RamManagement.directPermissions'),
        permissions: effectivePerms.value.directPermissions,
      },
      {
        source: i18ns.t('RamManagement.groupPermissions'),
        permissions: effectivePerms.value.groupPermissions,
      },
      {
        source: i18ns.t('RamManagement.rolePermissions'),
        permissions: effectivePerms.value.rolePermissions,
      },
      {
        source: i18ns.t('RamManagement.policyPermissions'),
        permissions: effectivePerms.value.policyPermissions,
      },
      {
        source: i18ns.t('RamManagement.permissionRemoves'),
        permissions: effectivePerms.value.permissionRemoves,
      },
    ]
  })

  const userActive = computed({
    get: () => userForm.status === 1,
    set: (value: boolean) => {
      userForm.status = value ? 1 : 0
    },
  })

  const can = (permission: Permission) => permissionStore.hasPermission(permission)
  const canReadUsers = computed(() => can(Permission.RAM_USER_READ))
  const canCreateUsers = computed(() => can(Permission.RAM_USER_CREATE))
  const canUpdateUsers = computed(() => can(Permission.RAM_USER_UPDATE))
  const canDeleteUsers = computed(() => can(Permission.RAM_USER_DELETE))
  const canReadRoles = computed(() => can(Permission.RAM_ROLE_READ))
  const canCreateRoles = computed(() => can(Permission.RAM_ROLE_CREATE))
  const canUpdateRoles = computed(() => can(Permission.RAM_ROLE_UPDATE))
  const canDeleteRoles = computed(() => can(Permission.RAM_ROLE_DELETE))
  const canReadBindings = computed(() => can(Permission.RAM_BINDING_READ))
  const canCreateBindings = computed(() => can(Permission.RAM_BINDING_CREATE))
  const canDeleteBindings = computed(() => can(Permission.RAM_BINDING_DELETE))
  const canReadSessions = computed(() => can(Permission.RAM_SESSION_READ))
  const canRevokeSessions = computed(() => can(Permission.RAM_SESSION_REVOKE))
  const canReadPolicies = computed(() => can(Permission.RAM_POLICY_READ))
  const canCreatePolicies = computed(() => can(Permission.RAM_POLICY_CREATE))
  const canUpdatePolicies = computed(() => can(Permission.RAM_POLICY_UPDATE))
  const canDeletePolicies = computed(() => can(Permission.RAM_POLICY_DELETE))
  const canAttachPolicies = computed(() => can(Permission.RAM_POLICY_ATTACH))
  const canDetachPolicies = computed(() => can(Permission.RAM_POLICY_DETACH))

  const bindOptions = computed(() =>
    bindMode.value === 'user'
      ? users.value.map((user) => ({
          id: user.id,
          label: user.displayName || user.ramUsername || user.username,
        }))
      : groups.value.map((group) => ({ id: group.id, label: group.name || group.username })),
  )

  const getBindingTargetName = (binding: RamRoleBindingDto) => {
    if (binding.source === 'user') {
      const user = users.value.find((item) => item.id === binding.principalId)
      return user?.displayName || user?.ramUsername || user?.username || binding.principalId
    }

    const group = groups.value.find((item) => item.id === binding.principalId)
    return group?.name || group?.username || binding.principalId
  }

  const getAttachmentTargetName = (attachment: RamPolicyAttachmentDto) => {
    if (attachment.targetName) return attachment.targetName

    if (attachment.targetType === 'user') {
      const user = users.value.find((item) => item.id === attachment.targetId)
      return user?.displayName || user?.ramUsername || user?.username || attachment.targetId
    }
    if (attachment.targetType === 'role') {
      const role = roles.value.find((item) => item.id === attachment.targetId)
      return role?.name || attachment.targetId
    }
    if (attachment.targetType === 'group') {
      const group = groups.value.find((item) => item.id === attachment.targetId)
      return group?.name || group?.username || attachment.targetId
    }

    return attachment.targetId
  }

  const userRules: FormRules = {
    username: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
    password: [
      {
        validator: (_rule: any, value: string, callback: any) => {
          if (userForm.passwordMode === 'custom' && (!value || value.length < 6)) {
            callback(new Error(i18ns.t('RamManagement.customPassword') + i18ns.t('required')))
          } else {
            callback()
          }
        },
        trigger: 'blur',
      },
    ],
  }

  const roleRules: FormRules = {
    name: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
  }

  const policyRules: FormRules = {
    name: [{ required: true, message: i18ns.t('required'), trigger: 'blur' }],
    permissions: [
      { required: true, type: 'array', min: 1, message: i18ns.t('required'), trigger: 'change' },
    ],
  }

  const formatDate = (value?: string) => (value ? new Date(value).toLocaleString() : '-')

  const formatRelativeTime = (value?: string) => {
    if (!value) return '-'

    const diff = new Date(value).getTime() - Date.now()
    if (diff < 0) {
      const ago = Math.floor(Math.abs(diff) / 1000)
      if (ago < 60) return i18ns.t('RamManagement.expired')
      if (ago < 3600) return `${Math.floor(ago / 60)}m ${i18ns.t('RamManagement.ago')}`
      if (ago < 86400) return `${Math.floor(ago / 3600)}h ${i18ns.t('RamManagement.ago')}`
      return `${Math.floor(ago / 86400)}d ${i18ns.t('RamManagement.ago')}`
    }

    if (diff < 60000) return i18ns.t('RamManagement.expiringSoon')
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
    return `${Math.floor(diff / 86400000)}d`
  }

  const loadUsers = async () => {
    if (!canReadUsers.value) {
      users.value = []
      return
    }
    loading.users = true
    try {
      users.value = await ramService.listUsers()
    } finally {
      loading.users = false
    }
  }

  const loadRoles = async () => {
    if (!canReadRoles.value) {
      roles.value = []
      selectedRoleId.value = ''
      return
    }
    loading.roles = true
    try {
      roles.value = await ramService.listRoles()
      if (!selectedRoleId.value && roles.value[0]) {
        selectedRoleId.value = roles.value[0].id
      }
    } finally {
      loading.roles = false
    }
  }

  const loadGroups = async () => {
    if (!canReadUsers.value && !canReadBindings.value && !canReadPolicies.value) {
      groups.value = []
      return
    }
    const data = await ramService.listGroups()
    groups.value = Array.isArray(data) ? data : ((data as any).groups ?? [])
  }

  const loadBindings = async () => {
    if (!canReadBindings.value || !selectedRoleId.value) {
      bindings.value = []
      return
    }
    loading.bindings = true
    try {
      bindings.value = await ramService.listRoleBindings(selectedRoleId.value)
    } finally {
      loading.bindings = false
    }
  }

  const loadSessions = async () => {
    if (!canReadSessions.value) {
      sessions.value = []
      return
    }
    loading.sessions = true
    try {
      sessions.value = await ramService.listSessions()
    } finally {
      loading.sessions = false
    }
  }

  const loadPolicies = async () => {
    if (!canReadPolicies.value) {
      policies.value = []
      return
    }
    loading.policies = true
    try {
      policies.value = await ramService.listPolicies()
    } finally {
      loading.policies = false
    }
  }

  const loadAll = async () => {
    try {
      await Promise.all([loadUsers(), loadRoles(), loadGroups(), loadSessions(), loadPolicies()])
      if (canReadBindings.value) {
        await loadBindings()
      }
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('loadFailed'))
    }
  }

  const selectRole = (role?: RamRoleDto) => {
    if (!role) return
    selectedRole.value = role
    selectedRoleId.value = role.id
    void loadBindings()
  }

  const openUserDialog = (user?: RamUserDto) => {
    if ((user && !canUpdateUsers.value) || (!user && !canCreateUsers.value)) return
    editingUser.value = user ?? null
    if (user) {
      Object.assign(userForm, {
        username: user.username,
        password: '',
        ramUsername: user.ramUsername ?? '',
        displayName: user.displayName ?? '',
        email: user.email ?? '',
        status: user.status,
      })
    }
    userDialogVisible.value = true
  }

  const resetUserForm = () => {
    editingUser.value = null
    Object.assign(userForm, {
      username: '',
      password: '',
      ramUsername: '',
      displayName: '',
      email: '',
      status: 1,
      groupId: '',
      accessTypes: ['console'],
      passwordMode: 'auto',
      passwordResetRequired: false,
      accessKeyName: '',
    })
    userFormRef.value?.clearValidate()
  }

  const genRandomPassword = (length = 16) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join(
      '',
    )
  }

  const submitUser = async () => {
    await userFormRef.value?.validate()
    submitting.value = true
    try {
      if (editingUser.value) {
        await ramService.updateUser(editingUser.value.id, {
          displayName: userForm.displayName,
          email: userForm.email,
          status: userForm.status,
        })
        ElMessage.success(i18ns.t('updateSuccess'))
      } else {
        const types = userForm.accessTypes
        const createData: Record<string, unknown> = {
          username: userForm.username,
          ramUsername: userForm.ramUsername || undefined,
          displayName: userForm.displayName || undefined,
          email: userForm.email || undefined,
          groupId: userForm.groupId || undefined,
          enableConsole: types.includes('console'),
          enableAccessKey: types.includes('accesskey'),
        }

        let plainPassword = ''
        if (types.includes('console')) {
          plainPassword = userForm.passwordMode === 'auto' ? genRandomPassword() : userForm.password
          createData.password = plainPassword
          createData.passwordResetRequired = userForm.passwordResetRequired
        } else {
          plainPassword = genRandomPassword()
          createData.password = plainPassword
        }

        if (types.includes('accesskey')) {
          createData.accessKeyName = userForm.accessKeyName || undefined
        }

        const result = await ramService.createUser(createData as any)
        if (types.includes('console') && userForm.passwordMode === 'auto' && plainPassword) {
          createdPasswordValue.value = plainPassword
          createdPasswordUsername.value = userForm.ramUsername || userForm.username
          passwordDialogVisible.value = true
        }
        if (result.accessKeySecret) {
          createdAccessKeySecret.value = result.accessKeySecret
          createdAccessKeyName.value =
            userForm.accessKeyName || `${userForm.ramUsername || userForm.username}`
          accessKeyDialogVisible.value = true
        }
        ElMessage.success(i18ns.t('createSuccess'))
      }
      userDialogVisible.value = false
      await loadUsers()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    } finally {
      submitting.value = false
    }
  }

  const copyAccessKeySecret = async () => {
    try {
      await navigator.clipboard.writeText(createdAccessKeySecret.value)
      ElMessage.success(i18ns.t('RamManagement.secretCopied'))
    } catch {
      ElMessage.error(i18ns.t('copyFailed'))
    }
  }

  const copyCreatedPassword = async () => {
    try {
      await navigator.clipboard.writeText(createdPasswordValue.value)
      ElMessage.success(i18ns.t('RamManagement.secretCopied'))
    } catch {
      ElMessage.error(i18ns.t('copyFailed'))
    }
  }

  const deleteUser = async (user: RamUserDto) => {
    if (!canDeleteUsers.value) return
    try {
      await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), { type: 'warning' })
    } catch {
      return
    }
    await ramService.deleteUser(user.id)
    ElMessage.success(i18ns.t('deleteSuccess'))
    await loadUsers()
  }

  const batchDeleteUsers = async () => {
    if (!canDeleteUsers.value || selectedUsers.value.length === 0) return
    try {
      await ElMessageBox.confirm(
        i18ns.t('RamManagement.confirmBatchDelete', { count: selectedUsers.value.length }),
        i18ns.t('warning'),
        { type: 'warning' },
      )
    } catch {
      return
    }
    try {
      await Promise.all(selectedUsers.value.map((user) => ramService.deleteUser(user.id)))
      ElMessage.success(i18ns.t('deleteSuccess'))
      selectedUsers.value = []
      await loadUsers()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }

  const openRoleDialog = (role?: RamRoleDto) => {
    if ((role && !canUpdateRoles.value) || (!role && !canCreateRoles.value)) return
    editingRole.value = role ?? null
    if (role) {
      Object.assign(roleForm, {
        name: role.name,
        description: role.description ?? '',
        maxSessionDuration: role.maxSessionDuration,
      })
    }
    roleDialogVisible.value = true
  }

  const resetRoleForm = () => {
    editingRole.value = null
    Object.assign(roleForm, { name: '', description: '', maxSessionDuration: 3600 })
    roleFormRef.value?.clearValidate()
  }

  const submitRole = async () => {
    await roleFormRef.value?.validate()
    submitting.value = true
    try {
      const payload = {
        description: roleForm.description,
        maxSessionDuration: roleForm.maxSessionDuration,
      }
      if (editingRole.value) {
        await ramService.updateRole(editingRole.value.id, payload)
        ElMessage.success(i18ns.t('updateSuccess'))
      } else {
        await ramService.createRole({ name: roleForm.name, ...payload })
        ElMessage.success(i18ns.t('createSuccess'))
      }
      roleDialogVisible.value = false
      await loadRoles()
      await loadBindings()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    } finally {
      submitting.value = false
    }
  }

  const deleteRole = async (role: RamRoleDto) => {
    if (!canDeleteRoles.value) return
    try {
      await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), { type: 'warning' })
    } catch {
      return
    }
    await ramService.deleteRole(role.id)
    ElMessage.success(i18ns.t('deleteSuccess'))
    await loadRoles()
    await loadBindings()
  }

  const batchDeleteRoles = async () => {
    if (!canDeleteRoles.value || selectedRoles.value.length === 0) return
    try {
      await ElMessageBox.confirm(
        i18ns.t('RamManagement.confirmBatchDelete', { count: selectedRoles.value.length }),
        i18ns.t('warning'),
        { type: 'warning' },
      )
    } catch {
      return
    }
    try {
      await Promise.all(selectedRoles.value.map((role) => ramService.deleteRole(role.id)))
      ElMessage.success(i18ns.t('deleteSuccess'))
      selectedRoles.value = []
      await loadRoles()
      await loadBindings()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }

  const cloneRole = (role: RamRoleDto) => {
    if (!canCreateRoles.value) return
    editingRole.value = null
    Object.assign(roleForm, {
      name: `${role.name} (${i18ns.t('RamManagement.clone')})`,
      description: role.description ?? '',
      maxSessionDuration: role.maxSessionDuration,
    })
    roleDialogVisible.value = true
  }

  const openBindDialog = (role: RamRoleDto, mode: 'user' | 'group') => {
    if (!canCreateBindings.value) return
    bindRole.value = role
    bindMode.value = mode
    bindDialogVisible.value = true
  }

  const submitBind = async () => {
    if (!bindRole.value || !bindTargetId.value) return
    submitting.value = true
    try {
      if (bindMode.value === 'user') {
        await ramService.bindRoleToUser(bindRole.value.id, { userId: bindTargetId.value })
      } else {
        await ramService.bindRoleToGroup(bindRole.value.id, { groupId: bindTargetId.value })
      }
      ElMessage.success(i18ns.t('success'))
      bindDialogVisible.value = false
      selectedRoleId.value = bindRole.value.id
      await loadBindings()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    } finally {
      submitting.value = false
    }
  }

  const unbind = async (binding: RamRoleBindingDto) => {
    if (!canDeleteBindings.value) return
    try {
      await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), { type: 'warning' })
    } catch {
      return
    }
    if (binding.source === 'user') {
      await ramService.unbindRoleFromUser(binding.roleId, binding.principalId)
    } else {
      await ramService.unbindRoleFromGroup(binding.roleId, binding.principalId)
    }
    ElMessage.success(i18ns.t('deleteSuccess'))
    await loadBindings()
  }

  const revokeSession = async (session: RamRoleSessionDto) => {
    if (!canRevokeSessions.value) return
    try {
      await ElMessageBox.confirm(i18ns.t('RamManagement.revokeConfirm'), i18ns.t('warning'), {
        type: 'warning',
      })
    } catch {
      return
    }
    await ramService.revokeSession(session.id)
    ElMessage.success(i18ns.t('success'))
    await loadSessions()
  }

  const openPolicyDialog = (policy?: RamPolicyDto) => {
    if ((policy && !canUpdatePolicies.value) || (!policy && !canCreatePolicies.value)) return
    if (policy) {
      editingPolicy.value = policy
      Object.assign(policyForm, {
        name: policy.name,
        description: policy.description ?? '',
        permissions: [...(policy.permissions ?? [])],
      })
    } else {
      resetPolicyForm()
    }
    policyDialogVisible.value = true
    nextTick(() => {
      policyPermTreeRef.value?.setCheckedKeys(policyForm.permissions)
      policyFormRef.value?.clearValidate()
    })
  }

  const resetPolicyForm = () => {
    editingPolicy.value = null
    Object.assign(policyForm, { name: '', description: '', permissions: [] })
    policyPermTreeRef.value?.setCheckedKeys([])
    policyFormRef.value?.clearValidate()
  }

  const onPolicyTreeCheck = () => {
    policyForm.permissions = filterGrantablePermissions(
      policyPermTreeRef.value?.getCheckedKeys() ?? [],
      grantablePermissions.value,
    )
  }

  const getGrantablePolicyPermissions = () =>
    filterGrantablePermissions(
      policyForm.permissions,
      grantablePermissions.value,
    ) as ClientPermission[]

  const submitPolicy = async () => {
    await policyFormRef.value?.validate()
    const permissions = getGrantablePolicyPermissions()
    submitting.value = true
    try {
      if (editingPolicy.value) {
        await ramService.updatePolicy(editingPolicy.value.id, {
          description: policyForm.description,
          permissions,
        })
        ElMessage.success(i18ns.t('updateSuccess'))
      } else {
        await ramService.createPolicy({
          name: policyForm.name,
          description: policyForm.description,
          permissions,
        })
        ElMessage.success(i18ns.t('createSuccess'))
      }
      policyDialogVisible.value = false
      await loadPolicies()
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    } finally {
      submitting.value = false
    }
  }

  const deletePolicy = async (policy: RamPolicyDto) => {
    if (!canDeletePolicies.value) return
    try {
      await ElMessageBox.confirm(i18ns.t('confirmDelete'), i18ns.t('warning'), { type: 'warning' })
    } catch {
      return
    }
    await ramService.deletePolicy(policy.id)
    ElMessage.success(i18ns.t('deleteSuccess'))
    await loadPolicies()
  }

  const openPolicyAttachments = async (policy: RamPolicyDto) => {
    selectedPolicy.value = policy
    showAttachForm.value = false
    attachDrawerVisible.value = true
    await loadPolicyAttachments(policy.id)
  }

  const loadPolicyAttachments = async (policyId: string) => {
    loading.attachments = true
    try {
      policyAttachments.value = await ramService.listPolicyAttachments(policyId)
    } finally {
      loading.attachments = false
    }
  }

  const submitAttach = async () => {
    if (!selectedPolicy.value || !attachForm.targetId) return
    submitting.value = true
    try {
      await ramService.attachPolicy({
        policyId: selectedPolicy.value.id,
        targetType: attachForm.targetType,
        targetId: attachForm.targetId,
      })
      ElMessage.success(i18ns.t('success'))
      showAttachForm.value = false
      attachForm.targetId = ''
      await loadPolicyAttachments(selectedPolicy.value.id)
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    } finally {
      submitting.value = false
    }
  }

  const detachAttachment = async (attachment: RamPolicyAttachmentDto) => {
    if (!canDetachPolicies.value) return
    try {
      await ElMessageBox.confirm(i18ns.t('RamManagement.confirmDetachPolicy'), i18ns.t('warning'), {
        type: 'warning',
      })
    } catch {
      return
    }
    try {
      await ramService.detachPolicy({
        policyId: attachment.policyId,
        targetType: attachment.targetType as 'user' | 'role' | 'group',
        targetId: attachment.targetId,
      })
      ElMessage.success(i18ns.t('deleteSuccess'))
      if (selectedPolicy.value) {
        await loadPolicyAttachments(selectedPolicy.value.id)
      }
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('operationFailed'))
    }
  }

  const loadEffectivePermissions = async () => {
    if (!authUserId.value) return
    try {
      effectivePerms.value = await ramService.getUserEffectivePermissions(authUserId.value)
    } catch (error: any) {
      ElMessage.error(error.message || i18ns.t('loadFailed'))
    }
  }

  const getPermLabel = (perm: string) => getPermissionLabel(perm, i18ns.refer.value as string)
  const getPermTooltip = (perm: string) => getPermissionTooltip(perm, i18ns.refer.value as string)

  onMounted(loadAll)

  return {
    Refresh,
    activeTab,
    attachDrawerVisible,
    attachForm,
    attachTargetOptions,
    authUserId,
    batchDeleteRoles,
    batchDeleteUsers,
    bindDialogVisible,
    bindMode,
    bindOptions,
    bindTargetId,
    bindings,
    canAttachPolicies,
    canCreateBindings,
    canCreatePolicies,
    canCreateRoles,
    canCreateUsers,
    canDeleteBindings,
    canDeletePolicies,
    canDeleteRoles,
    canDeleteUsers,
    canDetachPolicies,
    canReadBindings,
    canReadPolicies,
    canReadRoles,
    canReadSessions,
    canReadUsers,
    canRevokeSessions,
    canUpdatePolicies,
    canUpdateRoles,
    canUpdateUsers,
    cloneRole,
    copyAccessKeySecret,
    copyCreatedPassword,
    createdAccessKeyName,
    createdAccessKeySecret,
    createdPasswordUsername,
    createdPasswordValue,
    deletePolicy,
    deleteRole,
    deleteUser,
    detachAttachment,
    editingPolicy,
    editingRole,
    editingUser,
    effectivePerms,
    filteredPolicies,
    filteredRoles,
    filteredUsers,
    formatDate,
    formatRelativeTime,
    getAttachmentTargetName,
    getBindingTargetName,
    getPermLabel,
    getPermTooltip,
    groups,
    loadAll,
    loadBindings,
    loadEffectivePermissions,
    loadPolicyAttachments,
    loadSessions,
    loading,
    onPolicyTreeCheck,
    openBindDialog,
    openPolicyAttachments,
    openPolicyDialog,
    openRoleDialog,
    openUserDialog,
    passwordDialogVisible,
    permissionBreakdownSource,
    permissionTree,
    policies,
    policyAttachments,
    policyDialogVisible,
    policyForm,
    policyFormRef,
    policyPermTreeRef,
    policyRules,
    policySearch,
    resetPolicyForm,
    resetRoleForm,
    resetUserForm,
    revokeSession,
    roleDialogVisible,
    roleForm,
    roleFormRef,
    roleRules,
    roleSearch,
    roles,
    selectRole,
    selectedPolicy,
    selectedRole,
    selectedRoleId,
    selectedRoles,
    selectedUsers,
    sessions,
    showAttachForm,
    submitAttach,
    submitBind,
    submitPolicy,
    submitRole,
    submitUser,
    submitting,
    unbind,
    userActive,
    userDialogVisible,
    userForm,
    userFormRef,
    userRules,
    userSearch,
    users,
    accessKeyDialogVisible,
  }
}

export type RamManagementState = ReturnType<typeof useRamManagement>
