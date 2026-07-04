<template>
  <div class="ram-management desktop-page">
    <el-card class="page-card">
      <template #header>
        <div class="card-header toolbar-row">
          <span class="card-title">{{ i18ns.t('RamManagement.title') }}</span>
          <div class="header-actions">
            <el-button :icon="Refresh" @click="loadAll">{{ i18ns.t('refresh') }}</el-button>
          </div>
        </div>
      </template>

      <el-tabs v-model="activeTab" class="ram-tabs">
        <el-tab-pane :label="i18ns.t('RamManagement.users')" name="users">
          <div v-if="canReadUsers" class="section-toolbar">
            <div class="toolbar-left">
              <el-button
                v-if="canCreateUsers"
                type="primary"
                :icon="Plus"
                @click="openUserDialog()"
              >
                {{ i18ns.t('RamManagement.createUser') }}
              </el-button>
              <el-button
                v-if="selectedUsers.length > 0 && canDeleteUsers"
                type="danger"
                :icon="Delete"
                @click="batchDeleteUsers"
              >
                {{ i18ns.t('RamManagement.batchDelete') }} ({{ selectedUsers.length }})
              </el-button>
            </div>
            <el-input
              v-model="userSearch"
              :prefix-icon="Search"
              :placeholder="i18ns.t('RamManagement.searchPlaceholder')"
              clearable
              style="width: 280px"
            />
          </div>
          <el-table
            v-if="canReadUsers"
            v-loading="loading.users"
            :data="filteredUsers"
            border
            stripe
            @selection-change="(val: any) => (selectedUsers = val)"
          >
            <el-table-column type="selection" width="55" />
            <el-table-column prop="username" :label="i18ns.t('username')" min-width="150" />
            <el-table-column
              prop="ramUsername"
              :label="i18ns.t('RamManagement.ramUsername')"
              min-width="150"
            />
            <el-table-column
              prop="displayName"
              :label="i18ns.t('RamManagement.displayName')"
              min-width="150"
            />
            <el-table-column prop="email" :label="i18ns.t('email')" min-width="180" />
            <el-table-column :label="i18ns.t('status')" width="110">
              <template #default="{ row }">
                <el-tag :type="row.status === 1 ? 'success' : 'danger'" round effect="plain">
                  {{
                    row.status === 1
                      ? i18ns.t('RamManagement.active')
                      : i18ns.t('RamManagement.disabled')
                  }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="i18ns.t('actions')" fixed="right" width="180">
              <template #default="{ row }">
                <el-button v-if="canUpdateUsers" link type="primary" @click="openUserDialog(row)">{{
                  i18ns.t('edit')
                }}</el-button>
                <el-button v-if="canDeleteUsers" link type="danger" @click="deleteUser(row)">{{
                  i18ns.t('delete')
                }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else :description="i18ns.t('message.error.forbidden')" />
        </el-tab-pane>

        <el-tab-pane :label="i18ns.t('RamManagement.roles')" name="roles">
          <div v-if="canReadRoles" class="section-toolbar">
            <div class="toolbar-left">
              <el-button
                v-if="canCreateRoles"
                type="primary"
                :icon="Plus"
                @click="openRoleDialog()"
              >
                {{ i18ns.t('RamManagement.createRole') }}
              </el-button>
              <el-button
                v-if="selectedRoles.length > 0 && canDeleteRoles"
                type="danger"
                :icon="Delete"
                @click="batchDeleteRoles"
              >
                {{ i18ns.t('RamManagement.batchDelete') }} ({{ selectedRoles.length }})
              </el-button>
            </div>
            <el-input
              v-model="roleSearch"
              :prefix-icon="Search"
              :placeholder="i18ns.t('RamManagement.searchPlaceholder')"
              clearable
              style="width: 280px"
            />
          </div>
          <el-table
            v-if="canReadRoles"
            v-loading="loading.roles"
            :data="filteredRoles"
            border
            stripe
            @current-change="selectRole"
            @selection-change="(val: any) => (selectedRoles = val)"
          >
            <el-table-column type="selection" width="55" />
            <el-table-column
              prop="name"
              :label="i18ns.t('RamManagement.roleName')"
              min-width="160"
            />
            <el-table-column
              prop="description"
              :label="i18ns.t('description')"
              min-width="220"
              show-overflow-tooltip
            />
            <el-table-column :label="i18ns.t('RamManagement.permissionCount')" width="130">
              <template #default="{ row }">
                <el-tag round type="info">{{ row.permissions?.length ?? 0 }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column
              prop="maxSessionDuration"
              :label="i18ns.t('RamManagement.maxSessionDuration')"
              width="150"
            />
            <el-table-column :label="i18ns.t('actions')" fixed="right" width="340">
              <template #default="{ row }">
                <el-button v-if="canCreateRoles" link type="info" @click="cloneRole(row)">{{
                  i18ns.t('RamManagement.clone')
                }}</el-button>
                <el-button v-if="canUpdateRoles" link type="primary" @click="openRoleDialog(row)">{{
                  i18ns.t('edit')
                }}</el-button>
                <el-button
                  v-if="canCreateBindings"
                  link
                  type="primary"
                  @click="openBindDialog(row, 'user')"
                  >{{ i18ns.t('RamManagement.bindUser') }}</el-button
                >
                <el-button
                  v-if="canCreateBindings"
                  link
                  type="primary"
                  @click="openBindDialog(row, 'group')"
                  >{{ i18ns.t('RamManagement.bindGroup') }}</el-button
                >
                <el-button v-if="canDeleteRoles" link type="danger" @click="deleteRole(row)">{{
                  i18ns.t('delete')
                }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else :description="i18ns.t('message.error.forbidden')" />
        </el-tab-pane>

        <el-tab-pane :label="i18ns.t('RamManagement.bindings')" name="bindings">
          <div v-if="canReadBindings" class="section-toolbar">
            <el-select
              v-model="selectedRoleId"
              filterable
              :placeholder="i18ns.t('RamManagement.selectRole')"
              style="width: 280px"
              @change="loadBindings"
            >
              <el-option v-for="role in roles" :key="role.id" :label="role.name" :value="role.id" />
            </el-select>
          </div>
          <el-table
            v-if="canReadBindings"
            v-loading="loading.bindings"
            :data="bindings"
            border
            stripe
          >
            <el-table-column
              prop="roleName"
              :label="i18ns.t('RamManagement.roleName')"
              min-width="150"
            />
            <el-table-column :label="i18ns.t('RamManagement.bindingType')" width="120">
              <template #default="{ row }">
                {{
                  row.source === 'user'
                    ? i18ns.t('RamManagement.user')
                    : i18ns.t('RamManagement.group')
                }}
              </template>
            </el-table-column>
            <el-table-column :label="i18ns.t('RamManagement.bindingTarget')" min-width="180">
              <template #default="{ row }">{{ getBindingTargetName(row) }}</template>
            </el-table-column>
            <el-table-column :label="i18ns.t('RamManagement.permissionCount')" width="130">
              <template #default="{ row }">
                <el-tooltip :content="(row.permissions ?? []).join(', ') || '-'" placement="top">
                  <el-tag round type="info">{{ row.permissions?.length ?? 0 }}</el-tag>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column :label="i18ns.t('actions')" fixed="right" width="120">
              <template #default="{ row }">
                <el-button v-if="canDeleteBindings" link type="danger" @click="unbind(row)">{{
                  i18ns.t('delete')
                }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else :description="i18ns.t('message.error.forbidden')" />
        </el-tab-pane>

        <el-tab-pane :label="i18ns.t('RamManagement.sessions')" name="sessions">
          <div v-if="canReadSessions" class="section-toolbar">
            <el-button :icon="Refresh" @click="loadSessions">{{ i18ns.t('refresh') }}</el-button>
          </div>
          <el-table
            v-if="canReadSessions"
            v-loading="loading.sessions"
            :data="sessions"
            border
            stripe
          >
            <el-table-column
              prop="sessionName"
              :label="i18ns.t('RamManagement.sessionName')"
              min-width="170"
            />
            <el-table-column
              prop="roleName"
              :label="i18ns.t('RamManagement.roleName')"
              min-width="150"
            />
            <el-table-column
              prop="subjectUserId"
              :label="i18ns.t('RamManagement.subjectUserId')"
              min-width="220"
              show-overflow-tooltip
            />
            <el-table-column :label="i18ns.t('RamManagement.expiresAt')" min-width="200">
              <template #default="{ row }">
                <el-tooltip :content="formatDate(row.expiresAt)" placement="top">
                  <span>{{ formatRelativeTime(row.expiresAt) }}</span>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column :label="i18ns.t('actions')" fixed="right" width="120">
              <template #default="{ row }">
                <el-button
                  v-if="canRevokeSessions"
                  link
                  type="danger"
                  @click="revokeSession(row)"
                  >{{ i18ns.t('RamManagement.revoke') }}</el-button
                >
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else :description="i18ns.t('message.error.forbidden')" />
        </el-tab-pane>

        <!-- RAM 权限策略 -->
        <el-tab-pane :label="i18ns.t('RamManagement.policies')" name="policies">
          <div v-if="canReadPolicies" class="section-toolbar">
            <div class="toolbar-left">
              <el-button
                v-if="canCreatePolicies"
                type="primary"
                :icon="Plus"
                @click="openPolicyDialog()"
              >
                {{ i18ns.t('RamManagement.createPolicy') }}
              </el-button>
            </div>
            <el-input
              v-model="policySearch"
              :prefix-icon="Search"
              :placeholder="i18ns.t('RamManagement.searchPlaceholder')"
              clearable
              style="width: 280px"
            />
          </div>
          <el-table
            v-if="canReadPolicies"
            v-loading="loading.policies"
            :data="filteredPolicies"
            border
            stripe
          >
            <el-table-column
              prop="name"
              :label="i18ns.t('RamManagement.policyName')"
              min-width="180"
            />
            <el-table-column
              prop="description"
              :label="i18ns.t('RamManagement.policyDescription')"
              min-width="220"
              show-overflow-tooltip
            />
            <el-table-column :label="i18ns.t('RamManagement.policyType')" width="120">
              <template #default="{ row }">
                <el-tag round effect="plain">{{
                  row.type === 'custom' ? i18ns.t('RamManagement.customPolicy') : row.type
                }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="i18ns.t('RamManagement.permissionCount')" width="130">
              <template #default="{ row }">
                <el-tag round type="info">{{ row.permissions?.length ?? 0 }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="i18ns.t('actions')" fixed="right" width="280">
              <template #default="{ row }">
                <el-button
                  v-if="canReadPolicies"
                  link
                  type="info"
                  @click="openPolicyAttachments(row)"
                  >{{ i18ns.t('RamManagement.policyAttachments') }}</el-button
                >
                <el-button
                  v-if="canUpdatePolicies"
                  link
                  type="primary"
                  @click="openPolicyDialog(row)"
                  >{{ i18ns.t('edit') }}</el-button
                >
                <el-button v-if="canDeletePolicies" link type="danger" @click="deletePolicy(row)">{{
                  i18ns.t('delete')
                }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else :description="i18ns.t('message.error.forbidden')" />
        </el-tab-pane>

        <!-- 授权概览 -->
        <el-tab-pane :label="i18ns.t('RamManagement.authorization')" name="authorization">
          <div class="section-toolbar">
            <el-select
              v-model="authUserId"
              filterable
              :placeholder="i18ns.t('RamManagement.selectUser')"
              style="width: 320px"
              @change="loadEffectivePermissions"
            >
              <el-option
                v-for="user in users"
                :key="user.id"
                :label="user.displayName || user.ramUsername || user.username"
                :value="user.id"
              />
            </el-select>
            <el-button :icon="Refresh" @click="authUserId && loadEffectivePermissions()">{{
              i18ns.t('refresh')
            }}</el-button>
          </div>

          <div v-if="authUserId && effectivePerms" class="auth-summary">
            <el-descriptions :column="1" border>
              <el-descriptions-item :label="i18ns.t('username')">{{
                effectivePerms.ramUsername
              }}</el-descriptions-item>
              <el-descriptions-item
                :label="
                  i18ns.t('RamManagement.totalEffective', {
                    count: effectivePerms.effectivePermissions.length,
                  })
                "
              >
                <el-tag
                  v-for="perm in effectivePerms.effectivePermissions"
                  :key="perm"
                  round
                  style="margin: 2px"
                >
                  <el-tooltip :content="getPermTooltip(perm)" placement="top" :show-after="300">
                    <span>{{ getPermLabel(perm) }}</span>
                    <code class="perm-source">{{ perm }}</code>
                  </el-tooltip>
                </el-tag>
                <el-empty v-if="effectivePerms.effectivePermissions.length === 0" />
              </el-descriptions-item>
            </el-descriptions>

            <el-divider />

            <el-table :data="permissionBreakdownSource" border stripe>
              <el-table-column
                :label="i18ns.t('RamManagement.permissionSource')"
                width="160"
                prop="source"
              />
              <el-table-column :label="i18ns.t('RamManagement.permissions')" min-width="400">
                <template #default="{ row }">
                  <el-tag v-for="perm in row.permissions" :key="perm" round style="margin: 2px">
                    <el-tooltip :content="getPermTooltip(perm)" placement="top" :show-after="300">
                      <span>{{ getPermLabel(perm) }}</span>
                      <code class="perm-source">{{ perm }}</code>
                    </el-tooltip>
                  </el-tag>
                  <span v-if="row.permissions.length === 0" class="text-secondary">-</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <el-empty v-else-if="!authUserId" :description="i18ns.t('RamManagement.selectUser')" />
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-drawer
      v-model="userDialogVisible"
      :title="editingUser ? i18ns.t('RamManagement.editUser') : i18ns.t('RamManagement.createUser')"
      direction="rtl"
      size="720px"
      @closed="resetUserForm"
    >
      <el-form ref="userFormRef" :model="userForm" :rules="userRules" label-width="120px">
        <el-form-item v-if="!editingUser" :label="i18ns.t('username')" prop="username"
          ><el-input v-model="userForm.username"
        /></el-form-item>
        <el-form-item :label="i18ns.t('RamManagement.ramUsername')" prop="ramUsername"
          ><el-input v-model="userForm.ramUsername" :disabled="Boolean(editingUser)"
        /></el-form-item>
        <el-form-item :label="i18ns.t('RamManagement.displayName')" prop="displayName"
          ><el-input v-model="userForm.displayName"
        /></el-form-item>
        <el-form-item :label="i18ns.t('email')" prop="email"
          ><el-input v-model="userForm.email"
        /></el-form-item>
        <el-form-item :label="i18ns.t('status')" prop="status"
          ><el-switch v-model="userActive"
        /></el-form-item>

        <template v-if="!editingUser">
          <el-divider>{{ i18ns.t('RamManagement.accessConfig') }}</el-divider>

          <!-- 访问方式多选 -->
          <el-form-item :label="i18ns.t('RamManagement.accessConfig')" prop="accessType">
            <el-checkbox-group v-model="userForm.accessTypes">
              <el-checkbox value="console">{{
                i18ns.t('RamManagement.consoleAccess')
              }}</el-checkbox>
              <el-checkbox value="accesskey">{{
                i18ns.t('RamManagement.accessKeyAccess')
              }}</el-checkbox>
            </el-checkbox-group>
          </el-form-item>

          <!-- 控制台访问 -->
          <template v-if="userForm.accessTypes.includes('console')">
            <el-form-item :label="i18ns.t('RamManagement.passwordSetting')" prop="passwordMode">
              <el-radio-group v-model="userForm.passwordMode">
                <el-radio value="auto">{{
                  i18ns.t('RamManagement.autoGeneratePassword')
                }}</el-radio>
                <el-radio value="custom">{{ i18ns.t('RamManagement.customPassword') }}</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item
              v-if="userForm.passwordMode === 'custom'"
              :label="i18ns.t('password')"
              prop="password"
            >
              <el-input v-model="userForm.password" show-password />
            </el-form-item>
            <el-form-item
              :label="i18ns.t('RamManagement.passwordResetPolicy')"
              prop="passwordResetRequired"
            >
              <el-radio-group v-model="userForm.passwordResetRequired">
                <el-radio :value="true">{{ i18ns.t('RamManagement.mustResetPassword') }}</el-radio>
                <el-radio :value="false">{{ i18ns.t('RamManagement.noResetRequired') }}</el-radio>
              </el-radio-group>
            </el-form-item>
          </template>

          <!-- AccessKey 访问 -->
          <template v-if="userForm.accessTypes.includes('accesskey')">
            <el-form-item>
              <el-alert
                :title="i18ns.t('RamManagement.accessKeyDescription')"
                type="warning"
                show-icon
                :closable="false"
              />
            </el-form-item>
            <el-form-item :label="i18ns.t('RamManagement.accessKeyName')" prop="accessKeyName">
              <el-input v-model="userForm.accessKeyName" />
            </el-form-item>
          </template>

          <!-- 用户组选择 -->
          <el-form-item :label="i18ns.t('RamManagement.userGroup')" prop="groupId">
            <el-select v-model="userForm.groupId" filterable clearable style="width: 100%">
              <el-option
                v-for="g in groups"
                :key="g.id"
                :label="g.name || g.username"
                :value="g.id"
              />
            </el-select>
            <div class="text-secondary" style="font-size: 12px; margin-top: 4px">
              {{ i18ns.t('RamManagement.userGroupHint') }}
            </div>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <div style="display: flex; gap: 12px; justify-content: flex-start">
          <el-button @click="userDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="submitting" @click="submitUser">{{
            i18ns.t('confirm')
          }}</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- AccessKey 创建成功弹窗 -->
    <el-dialog
      v-model="accessKeyDialogVisible"
      :title="i18ns.t('RamManagement.accessKeyCreated')"
      width="520px"
    >
      <el-alert
        :title="i18ns.t('RamManagement.accessKeyDescription')"
        type="warning"
        show-icon
        :closable="false"
        style="margin-bottom: 16px"
      />
      <el-descriptions :column="1" border>
        <el-descriptions-item :label="i18ns.t('RamManagement.accessKeyName')">{{
          createdAccessKeyName
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('RamManagement.accessKeySecret')">
          <div style="display: flex; gap: 8px; align-items: center">
            <code style="word-break: break-all; font-size: 13px">{{ createdAccessKeySecret }}</code>
            <el-button size="small" @click="copyAccessKeySecret">{{
              i18ns.t('RamManagement.copySecret')
            }}</el-button>
          </div>
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="accessKeyDialogVisible = false">{{
          i18ns.t('confirm')
        }}</el-button>
      </template>
    </el-dialog>

    <!-- 自动生成密码展示弹窗 -->
    <el-dialog
      v-model="passwordDialogVisible"
      :title="i18ns.t('RamManagement.userCreated')"
      width="480px"
    >
      <el-descriptions :column="1" border>
        <el-descriptions-item :label="i18ns.t('username')">{{
          createdPasswordUsername
        }}</el-descriptions-item>
        <el-descriptions-item :label="i18ns.t('password')">
          <div style="display: flex; gap: 8px; align-items: center">
            <code style="font-size: 14px; letter-spacing: 0.5px">{{ createdPasswordValue }}</code>
            <el-button size="small" @click="copyCreatedPassword">{{
              i18ns.t('RamManagement.copySecret')
            }}</el-button>
          </div>
        </el-descriptions-item>
      </el-descriptions>
      <el-alert
        :title="i18ns.t('RamManagement.savePasswordHint')"
        type="warning"
        show-icon
        :closable="false"
        style="margin-top: 16px"
      />
      <template #footer>
        <el-button type="primary" @click="passwordDialogVisible = false">{{
          i18ns.t('confirm')
        }}</el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="roleDialogVisible"
      :title="editingRole ? i18ns.t('RamManagement.editRole') : i18ns.t('RamManagement.createRole')"
      direction="rtl"
      size="65%"
      @closed="resetRoleForm"
    >
      <el-form ref="roleFormRef" :model="roleForm" :rules="roleRules" label-width="150px">
        <el-form-item v-if="!editingRole" :label="i18ns.t('RamManagement.roleName')" prop="name"
          ><el-input v-model="roleForm.name"
        /></el-form-item>
        <el-form-item :label="i18ns.t('description')" prop="description"
          ><el-input v-model="roleForm.description" type="textarea" :rows="2"
        /></el-form-item>
        <el-form-item :label="i18ns.t('RamManagement.maxSessionDuration')" prop="maxSessionDuration"
          ><el-input-number v-model="roleForm.maxSessionDuration" :min="900" :max="43200"
        /></el-form-item>
        <el-alert
          :title="i18ns.t('RamManagement.rolePermissionsViaPolicies')"
          type="info"
          show-icon
          :closable="false"
          style="margin-top: 8px"
        />
      </el-form>
      <template #footer>
        <div style="display: flex; gap: 12px; justify-content: flex-start">
          <el-button @click="roleDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="submitting" @click="submitRole">{{
            i18ns.t('confirm')
          }}</el-button>
        </div>
      </template>
    </el-drawer>

    <el-dialog
      v-model="bindDialogVisible"
      :title="
        bindMode === 'user' ? i18ns.t('RamManagement.bindUser') : i18ns.t('RamManagement.bindGroup')
      "
      width="460px"
      @closed="bindTargetId = ''"
    >
      <el-form label-width="110px">
        <el-form-item
          :label="
            bindMode === 'user' ? i18ns.t('RamManagement.user') : i18ns.t('RamManagement.group')
          "
        >
          <el-select v-model="bindTargetId" filterable style="width: 100%">
            <el-option
              v-for="option in bindOptions"
              :key="option.id"
              :label="option.label"
              :value="option.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <div style="display: flex; gap: 12px; justify-content: flex-start">
          <el-button @click="bindDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="submitting" @click="submitBind">{{
            i18ns.t('confirm')
          }}</el-button>
        </div>
      </template>
    </el-dialog>

    <el-drawer
      v-model="policyDialogVisible"
      :title="
        editingPolicy ? i18ns.t('RamManagement.editPolicy') : i18ns.t('RamManagement.createPolicy')
      "
      direction="rtl"
      size="65%"
      @closed="resetPolicyForm"
    >
      <el-form ref="policyFormRef" :model="policyForm" :rules="policyRules" label-width="140px">
        <el-form-item v-if="!editingPolicy" :label="i18ns.t('RamManagement.policyName')" prop="name"
          ><el-input v-model="policyForm.name"
        /></el-form-item>
        <el-form-item :label="i18ns.t('RamManagement.policyDescription')" prop="description"
          ><el-input v-model="policyForm.description" type="textarea" :rows="2"
        /></el-form-item>
        <el-form-item :label="i18ns.t('RamManagement.permissions')" prop="permissions">
          <div class="permission-tree-container">
            <el-tree
              ref="policyPermTreeRef"
              :data="permissionTree"
              show-checkbox
              node-key="value"
              :default-checked-keys="policyForm.permissions"
              @check="onPolicyTreeCheck"
            >
              <template #default="{ data }">
                <el-tooltip
                  v-if="data.tooltip"
                  :content="data.tooltip"
                  placement="right"
                  :show-after="300"
                >
                  <span>{{ data.label }}</span>
                  <code class="perm-source">{{ data.value }}</code>
                </el-tooltip>
                <span v-else>{{ data.label }}</span>
              </template>
            </el-tree>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <div style="display: flex; gap: 12px; justify-content: flex-start">
          <el-button @click="policyDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
          <el-button type="primary" :loading="submitting" @click="submitPolicy">{{
            i18ns.t('confirm')
          }}</el-button>
        </div>
      </template>
    </el-drawer>

    <el-drawer
      v-model="attachDrawerVisible"
      :title="i18ns.t('RamManagement.policyAttachments')"
      direction="rtl"
      size="650px"
    >
      <div class="section-toolbar">
        <el-button
          v-if="canAttachPolicies"
          type="primary"
          :icon="Plus"
          size="small"
          @click="showAttachForm = true"
        >
          {{ i18ns.t('RamManagement.attachPolicy') }}
        </el-button>
      </div>
      <div
        v-if="showAttachForm"
        class="attach-form"
        style="
          margin-bottom: 12px;
          padding: 8px;
          border: 1px solid var(--el-border-color);
          border-radius: 4px;
        "
      >
        <el-form label-width="100px" size="small">
          <el-form-item :label="i18ns.t('RamManagement.targetType')">
            <el-radio-group v-model="attachForm.targetType">
              <el-radio value="user">{{ i18ns.t('RamManagement.user') }}</el-radio>
              <el-radio value="role">{{ i18ns.t('RamManagement.roles') }}</el-radio>
              <el-radio value="group">{{ i18ns.t('RamManagement.group') }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="i18ns.t('RamManagement.targetName')">
            <el-select v-model="attachForm.targetId" filterable style="width: 100%">
              <el-option
                v-for="opt in attachTargetOptions"
                :key="opt.id"
                :label="opt.label"
                :value="opt.id"
              />
            </el-select>
          </el-form-item>
          <div style="display: flex; gap: 8px; justify-content: flex-start">
            <el-button size="small" @click="showAttachForm = false">{{
              i18ns.t('cancel')
            }}</el-button>
            <el-button size="small" type="primary" :loading="submitting" @click="submitAttach">{{
              i18ns.t('confirm')
            }}</el-button>
          </div>
        </el-form>
      </div>
      <el-table
        v-loading="loading.attachments"
        :data="policyAttachments"
        border
        stripe
        size="small"
      >
        <el-table-column :label="i18ns.t('RamManagement.targetType')" width="100">
          <template #default="{ row }">{{ row.targetType }}</template>
        </el-table-column>
        <el-table-column :label="i18ns.t('RamManagement.targetName')" min-width="180">
          <template #default="{ row }">
            {{ getAttachmentTargetName(row) }}
          </template>
        </el-table-column>
        <el-table-column :label="i18ns.t('actions')" width="100">
          <template #default="{ row }">
            <el-button
              v-if="canDetachPolicies"
              link
              type="danger"
              size="small"
              @click="detachAttachment(row)"
              >{{ i18ns.t('RamManagement.detachPolicy') }}</el-button
            >
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="policyAttachments.length === 0 && !loading.attachments" />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  ElMessage,
  ElMessageBox,
  ElDrawer,
  ElTree,
  ElTooltip,
  type FormInstance,
  type FormRules,
} from 'element-plus'
import { Plus, Refresh, Delete, Search } from '@element-plus/icons-vue'
import {
  ALL_PERMISSIONS,
  getPermissionCategory,
  getPermissionLabel,
  getPermissionTooltip,
} from '@/constant/permission'
import { Permission } from '@/constant/permission'
import type {
  GroupDto,
  RamPolicyAttachmentDto,
  RamPolicyDto,
  RamRoleBindingDto,
  RamRoleDto,
  RamRoleSessionDto,
  RamUserDto,
  EffectivePermissionDto,
} from '@/client/types.gen'
import { ramService } from '@/service/ramService'
import { i18ns } from '@/locales'
import { usePermissionStore } from '@/stores/permissionStore'

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

const userSearch = ref('')
const roleSearch = ref('')
const policySearch = ref('')
const selectedUsers = ref<any[]>([])
const selectedRoles = ref<any[]>([])
const permTreeRef = ref()
const policyPermTreeRef = ref()

// Policy & Attachment state
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

const permissionTree = computed(() => {
  const locale = i18ns.refer.value as string
  const categories = new Map<string, { label: string; value: string; tooltip: string }[]>()
  for (const perm of ALL_PERMISSIONS) {
    const cat = getPermissionCategory(perm)
    if (!categories.has(cat)) categories.set(cat, [])
    categories.get(cat)!.push({
      label: getPermissionLabel(perm, locale),
      value: perm,
      tooltip: getPermissionTooltip(perm, locale),
    })
  }
  return Array.from(categories.entries())
    .map(([cat, children]) => {
      const prefix = cat.charAt(0).toLowerCase() + cat.slice(1)
      return {
        label: i18ns.t(`RamManagement.permissionCategoryLabels.${prefix}` as any),
        value: cat,
        tooltip: i18ns.t(`RamManagement.permissionCategoryTooltips.${prefix}` as any),
        children,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
})

const filteredUsers = computed(() => {
  const q = userSearch.value.toLowerCase()
  if (!q) return users.value
  return users.value.filter((u) =>
    [u.username, u.ramUsername, u.displayName, u.email].some((s) => s?.toLowerCase().includes(q)),
  )
})

const filteredRoles = computed(() => {
  const q = roleSearch.value.toLowerCase()
  if (!q) return roles.value
  return roles.value.filter((r) =>
    [r.name, r.description].some((s) => s?.toLowerCase().includes(q)),
  )
})

const filteredPolicies = computed(() => {
  const q = policySearch.value.toLowerCase()
  if (!q) return policies.value
  return policies.value.filter((p) =>
    [p.name, p.description].some((s) => s?.toLowerCase().includes(q)),
  )
})

const attachTargetOptions = computed(() => {
  if (attachForm.targetType === 'user') {
    return users.value.map((u) => ({
      id: u.id,
      label: u.displayName || u.ramUsername || u.username,
    }))
  }
  if (attachForm.targetType === 'role') {
    return roles.value.map((r) => ({ id: r.id, label: r.name }))
  }
  return groups.value.map((g) => ({ id: g.id, label: g.name || g.username }))
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
  set: (value: boolean) => (userForm.status = value ? 1 : 0),
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
    if (!selectedRoleId.value && roles.value[0]) selectedRoleId.value = roles.value[0].id
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
  if (!canReadBindings.value) {
    bindings.value = []
    return
  }
  if (!selectedRoleId.value) {
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
        // 纯 AccessKey 模式，生成随机密码
        plainPassword = genRandomPassword()
        createData.password = plainPassword
      }

      if (types.includes('accesskey')) {
        createData.accessKeyName = userForm.accessKeyName || undefined
      }

      const result = await ramService.createUser(createData as any)
      // 展示自动生成的密码
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
    await Promise.all(selectedUsers.value.map((u: any) => ramService.deleteUser(u.id)))
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
    await Promise.all(selectedRoles.value.map((r: any) => ramService.deleteRole(r.id)))
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
  if (binding.source === 'user')
    await ramService.unbindRoleFromUser(binding.roleId, binding.principalId)
  else await ramService.unbindRoleFromGroup(binding.roleId, binding.principalId)
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

// ── 权限策略 ──

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

const openPolicyDialog = (policy?: RamPolicyDto) => {
  if ((policy && !canUpdatePolicies.value) || (!policy && !canCreatePolicies.value)) return
  editingPolicy.value = policy ?? null
  if (policy) {
    Object.assign(policyForm, {
      name: policy.name,
      description: policy.description ?? '',
      permissions: [...(policy.permissions ?? [])],
    })
  }
  policyDialogVisible.value = true
}

const resetPolicyForm = () => {
  editingPolicy.value = null
  Object.assign(policyForm, { name: '', description: '', permissions: [] })
  policyFormRef.value?.clearValidate()
}

const onPolicyTreeCheck = () => {
  policyForm.permissions = policyPermTreeRef.value?.getCheckedKeys() ?? []
}

const submitPolicy = async () => {
  await policyFormRef.value?.validate()
  submitting.value = true
  try {
    if (editingPolicy.value) {
      await ramService.updatePolicy(editingPolicy.value.id, {
        description: policyForm.description,
        permissions: policyForm.permissions,
      })
      ElMessage.success(i18ns.t('updateSuccess'))
    } else {
      await ramService.createPolicy({
        name: policyForm.name,
        description: policyForm.description,
        permissions: policyForm.permissions,
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

// ── 授权概览 ──

const loadEffectivePermissions = async () => {
  if (!authUserId.value) return
  try {
    effectivePerms.value = await ramService.getUserEffectivePermissions(authUserId.value)
  } catch (error: any) {
    ElMessage.error(error.message || i18ns.t('loadFailed'))
  }
}

onMounted(loadAll)

// ── 权限显示辅助 ──

function getPermLabel(perm: string): string {
  return getPermissionLabel(perm, i18ns.refer.value as string)
}

function getPermTooltip(perm: string): string {
  return getPermissionTooltip(perm, i18ns.refer.value as string)
}
</script>

<style scoped>
.ram-management {
  min-width: 0;
}

.section-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.permission-tree-container {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 8px;
  max-height: 420px;
  overflow-y: auto;
  width: 100%;
}

.permission-tree-container .el-tree-node__content {
  white-space: nowrap;
}

.perm-source {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-left: 6px;
  background: var(--el-fill-color-lighter);
  padding: 0 4px;
  border-radius: 2px;
  white-space: nowrap;
}

.auth-summary {
  width: 100%;
  overflow-x: auto;
}

.auth-summary .el-descriptions {
  width: 100%;
}

.auth-summary .el-descriptions__cell {
  word-break: break-word;
}

.card-header,
.section-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-toolbar {
  margin-bottom: 12px;
}

.ram-tabs :deep(.el-tabs__content) {
  overflow: visible;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media screen and (max-width: 768px) {
  .card-header,
  .section-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
