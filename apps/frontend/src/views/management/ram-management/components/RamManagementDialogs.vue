<template>
  <el-drawer
    v-model="userDialogVisible"
    :title="editingUser ? i18ns.t('RamManagement.editUser') : i18ns.t('RamManagement.createUser')"
    direction="rtl"
    size="720px"
    @closed="resetUserForm"
  >
    <el-form ref="userFormRef" :model="userForm" :rules="userRules" label-width="120px">
      <el-form-item v-if="!editingUser" :label="i18ns.t('username')" prop="username">
        <el-input v-model="userForm.username" />
      </el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.ramUsername')" prop="ramUsername">
        <el-input v-model="userForm.ramUsername" :disabled="Boolean(editingUser)" />
      </el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.displayName')" prop="displayName">
        <el-input v-model="userForm.displayName" />
      </el-form-item>
      <el-form-item :label="i18ns.t('email')" prop="email">
        <el-input v-model="userForm.email" />
      </el-form-item>
      <el-form-item :label="i18ns.t('status')" prop="status">
        <el-switch v-model="userActive" />
      </el-form-item>

      <template v-if="!editingUser">
        <el-divider>{{ i18ns.t('RamManagement.accessConfig') }}</el-divider>

        <el-form-item :label="i18ns.t('RamManagement.accessConfig')" prop="accessType">
          <el-checkbox-group v-model="userForm.accessTypes">
            <el-checkbox value="console">{{ i18ns.t('RamManagement.consoleAccess') }}</el-checkbox>
            <el-checkbox value="accesskey">{{
              i18ns.t('RamManagement.accessKeyAccess')
            }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>

        <template v-if="userForm.accessTypes.includes('console')">
          <el-form-item :label="i18ns.t('RamManagement.passwordSetting')" prop="passwordMode">
            <el-radio-group v-model="userForm.passwordMode">
              <el-radio value="auto">{{ i18ns.t('RamManagement.autoGeneratePassword') }}</el-radio>
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

        <el-form-item :label="i18ns.t('RamManagement.userGroup')" prop="groupId">
          <el-select v-model="userForm.groupId" filterable clearable style="width: 100%">
            <el-option
              v-for="group in groups"
              :key="group.id"
              :label="group.name || group.username"
              :value="group.id"
            />
          </el-select>
          <div class="text-secondary field-hint">{{ i18ns.t('RamManagement.userGroupHint') }}</div>
        </el-form-item>
      </template>
    </el-form>
    <template #footer>
      <div class="form-footer">
        <el-button @click="userDialogVisible = false">{{ i18ns.t('cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="submitUser">{{
          i18ns.t('confirm')
        }}</el-button>
      </div>
    </template>
  </el-drawer>

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
      class="dialog-alert"
    />
    <el-descriptions :column="1" border>
      <el-descriptions-item :label="i18ns.t('RamManagement.accessKeyName')">
        {{ createdAccessKeyName }}
      </el-descriptions-item>
      <el-descriptions-item :label="i18ns.t('RamManagement.accessKeySecret')">
        <div class="secret-row">
          <code class="secret-code">{{ createdAccessKeySecret }}</code>
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
        <div class="secret-row">
          <code class="password-code">{{ createdPasswordValue }}</code>
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
      class="alert-top-gap"
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
      <el-form-item v-if="!editingRole" :label="i18ns.t('RamManagement.roleName')" prop="name">
        <el-input v-model="roleForm.name" />
      </el-form-item>
      <el-form-item :label="i18ns.t('description')" prop="description">
        <el-input v-model="roleForm.description" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.maxSessionDuration')" prop="maxSessionDuration">
        <el-input-number v-model="roleForm.maxSessionDuration" :min="900" :max="43200" />
      </el-form-item>
      <el-alert
        :title="i18ns.t('RamManagement.rolePermissionsViaPolicies')"
        type="info"
        show-icon
        :closable="false"
        class="role-info-alert"
      />
    </el-form>
    <template #footer>
      <div class="form-footer">
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
      <div class="form-footer">
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
      <el-form-item v-if="!editingPolicy" :label="i18ns.t('RamManagement.policyName')" prop="name">
        <el-input v-model="policyForm.name" />
      </el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.policyDescription')" prop="description">
        <el-input v-model="policyForm.description" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.permissions')" prop="permissions">
        <div class="permission-tree-container">
          <el-tree
            v-if="permissionTree.length > 0"
            ref="policyPermTreeRef"
            :data="permissionTree"
            show-checkbox
            node-key="value"
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
          <el-empty v-else :description="i18ns.t('RamManagement.noGrantablePermissions')" />
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="form-footer">
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

    <div v-if="showAttachForm" class="attach-form">
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
              v-for="option in attachTargetOptions"
              :key="option.id"
              :label="option.label"
              :value="option.id"
            />
          </el-select>
        </el-form-item>
        <div class="form-footer">
          <el-button size="small" @click="showAttachForm = false">{{
            i18ns.t('cancel')
          }}</el-button>
          <el-button size="small" type="primary" :loading="submitting" @click="submitAttach">{{
            i18ns.t('confirm')
          }}</el-button>
        </div>
      </el-form>
    </div>

    <el-table v-loading="loading.attachments" :data="policyAttachments" border stripe size="small">
      <el-table-column :label="i18ns.t('RamManagement.targetType')" width="100">
        <template #default="{ row }">{{ row.targetType }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('RamManagement.targetName')" min-width="180">
        <template #default="{ row }">{{ getAttachmentTargetName(row) }}</template>
      </el-table-column>
      <el-table-column :label="i18ns.t('actions')" width="100">
        <template #default="{ row }">
          <el-button
            v-if="canDetachPolicies"
            link
            type="danger"
            size="small"
            @click="detachAttachment(row)"
          >
            {{ i18ns.t('RamManagement.detachPolicy') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="policyAttachments.length === 0 && !loading.attachments" />
  </el-drawer>
</template>

<script setup lang="ts">
import { Plus } from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { useRamManagementContext } from '../context'

const {
  accessKeyDialogVisible,
  attachDrawerVisible,
  attachForm,
  attachTargetOptions,
  bindDialogVisible,
  bindMode,
  bindOptions,
  bindTargetId,
  canAttachPolicies,
  canDetachPolicies,
  copyAccessKeySecret,
  copyCreatedPassword,
  createdAccessKeyName,
  createdAccessKeySecret,
  createdPasswordUsername,
  createdPasswordValue,
  detachAttachment,
  editingPolicy,
  editingRole,
  editingUser,
  groups,
  loading,
  onPolicyTreeCheck,
  passwordDialogVisible,
  permissionTree,
  policyAttachments,
  policyDialogVisible,
  policyForm,
  policyFormRef,
  policyPermTreeRef,
  policyRules,
  resetPolicyForm,
  resetRoleForm,
  resetUserForm,
  roleDialogVisible,
  roleForm,
  roleFormRef,
  roleRules,
  showAttachForm,
  submitAttach,
  submitBind,
  submitPolicy,
  submitRole,
  submitUser,
  submitting,
  userActive,
  userDialogVisible,
  userForm,
  userFormRef,
  userRules,
  getAttachmentTargetName,
} = useRamManagementContext()
</script>
