<template>
  <section class="authorization-form">
    <el-alert
      :title="i18ns.t('RamManagement.scopedAuthorizationHint')"
      type="info"
      :closable="false"
    />
    <el-form label-position="top" class="authorization-boundary">
      <el-form-item :label="i18ns.t('RamManagement.scopedScope')">
        <el-select v-model="scopeType" :disabled="locked" data-test="authorization-scope"
          ><el-option
            v-for="type in scopeTypes"
            :key="type"
            :value="type"
            :label="scopeLabels[type]"
        /></el-select>
      </el-form-item>
      <el-form-item :label="i18ns.t('RamManagement.scopedPrincipalType')">
        <el-select
          v-model="principalType"
          :disabled="locked"
          data-test="authorization-principal-type"
          ><el-option
            v-for="type in principalTypes"
            :key="type"
            :value="type"
            :label="principalLabels[type]"
        /></el-select>
      </el-form-item>
      <el-form-item
        v-if="scopeType === 'resource'"
        :label="i18ns.t('RamManagement.scopedResourceArn')"
        ><el-input v-model="scopeArn" :disabled="locked" data-test="authorization-arn"
      /></el-form-item>
    </el-form>
    <RamIamAuthorizationPicker
      v-if="scopeType === 'resource-group'"
      v-model="groups"
      :title="i18ns.t('RamManagement.scopedResourceGroups')"
      :fetch-page="fetchGroups"
      :disabled="locked"
      data-test="authorization-group-picker"
    />
    <div class="authorization-columns">
      <RamIamAuthorizationPicker
        v-model="principals"
        :title="i18ns.t('RamManagement.authorizationPrincipals')"
        :fetch-page="fetchPrincipals"
        :disabled="locked"
        multiple
        data-test="authorization-principal-picker"
      />
      <RamIamAuthorizationPicker
        v-model="policies"
        :title="i18ns.t('RamManagement.authorizationPolicies')"
        :fetch-page="fetchPolicies"
        :disabled="locked"
        multiple
        data-test="authorization-policy-picker"
      />
    </div>
    <el-alert
      v-if="highRisk"
      :title="i18ns.t('RamManagement.authorizationHighRiskHint')"
      type="warning"
      :closable="false"
    />
    <p class="authorization-summary" data-test="authorization-summary">
      {{
        i18ns.t('RamManagement.authorizationSummary', {
          principals: principals.length,
          policies: policies.length,
          count: requestCount,
        })
      }}
      · {{ scopeLabels[scopeType] }}
      <code>{{
        scopeType === 'resource-group' ? groups[0]?.label : scopeType === 'resource' ? scopeArn : ''
      }}</code>
    </p>
    <el-alert
      v-if="requestCount > limits.requests"
      :title="i18ns.t('RamManagement.authorizationLimit', { limit: limits.requests })"
      type="error"
      :closable="false"
    />
    <p v-if="batch.total.value" data-test="authorization-progress">
      {{
        i18ns.t('RamManagement.authorizationProgress', {
          completed: batch.completed.value,
          total: batch.total.value,
          remaining: batch.pending.value?.length ?? 0,
        })
      }}
    </p>
    <div class="authorization-actions">
      <el-button
        data-test="authorization-create"
        type="primary"
        :disabled="busy || (!batch.pending.value && !complete)"
        :loading="busy"
        @click="create"
        >{{
          i18ns.t(
            batch.pending.value
              ? 'RamManagement.authorizationRetry'
              : 'RamManagement.scopedCreateAuthorization',
          )
        }}</el-button
      >
      <el-button
        v-if="batch.pending.value && !busy"
        data-test="authorization-discard"
        @click="discard"
        >{{ i18ns.t('RamManagement.authorizationDiscard') }}</el-button
      >
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import {
  IAM_PRINCIPAL_TYPES as principalTypes,
  IAM_AUTHORIZATION_SCOPE_TYPES as scopeTypes,
} from '@quyan/shared'
import type { CreateRamAuthorizationDto } from '@/client/types.gen'
import { ramService } from '@/service/ramService'
import { i18ns } from '@/locales'
import { ElMessageBox } from '@/utils/elementPlusRuntime'
import { showRequestErrorNotice } from '@/utils/requestErrorNotice'
import {
  IAM_AUTHORIZATION_SELECTION_LIMITS as limits,
  buildIamAuthorizationRequests,
  iamAuthorizationPolicyHighRisk,
} from '../iam-authorization-selection'
import type {
  IamAuthorizationOption,
  IamAuthorizationOptionQuery,
} from '../iam-authorization-selection'
import { useIamAuthorizationBatch } from '../useIamAuthorizationBatch'
import RamIamAuthorizationPicker from './RamIamAuthorizationPicker.vue'
const props = defineProps<{ selectedResourceGroup?: { id: string } }>()
const emit = defineEmits<{ created: [] }>()
const principalType = ref<CreateRamAuthorizationDto['principalType']>('user')
const scopeType = ref<CreateRamAuthorizationDto['scopeType']>('account')
const scopeArn = ref('')
const scopeLabels = computed(() => ({
  account: i18ns.t('RamManagement.authorizationScope.account'),
  'resource-group': i18ns.t('RamManagement.authorizationScope.resource-group'),
  resource: i18ns.t('RamManagement.authorizationScope.resource'),
}))
const principalLabels = computed(() => ({
  user: i18ns.t('RamManagement.authorizationPrincipal.user'),
  group: i18ns.t('RamManagement.authorizationPrincipal.group'),
  role: i18ns.t('RamManagement.authorizationPrincipal.role'),
}))

const principals = shallowRef<IamAuthorizationOption[]>([]),
  policies = shallowRef<IamAuthorizationOption[]>([]),
  groups = shallowRef<IamAuthorizationOption[]>([])
const confirming = ref(false)
const batch = useIamAuthorizationBatch((request) => ramService.createAuthorization(request))
const busy = computed(() => confirming.value || batch.busy.value)
const locked = computed(() => busy.value || !!batch.pending.value)
const requestCount = computed(() => principals.value.length * policies.value.length)
const highRisk = computed(() => policies.value.some((policy) => policy.highRisk))
const requests = () =>
  buildIamAuthorizationRequests(
    {
      principalType: principalType.value,
      scopeType: scopeType.value,
      scopeArn: scopeArn.value,
      scopeResourceId: groups.value[0]?.id,
    },
    principals.value.map((item) => item.id),
    policies.value.map((item) => item.id),
  )
const complete = computed(() => {
  try {
    return requests().length > 0
  } catch {
    return false
  }
})
const fetchPrincipals = computed(() => {
  const type = principalType.value
  return async (query: IamAuthorizationOptionQuery) => {
    if (type === 'user') {
      const page = await ramService.listUsersPage(query)
      return {
        ...page,
        items: page.items.map((user) => ({
          id: user.id,
          label: user.displayName || user.ramUsername || user.username,
        })),
      }
    }
    if (type === 'group') {
      const page = await ramService.listVisibleGroupPage(query)
      return {
        ...page,
        items: page.items.map((group) => ({
          id: group.id,
          label: group.name || group.username,
          description: group.description || undefined,
        })),
      }
    }
    const page = await ramService.listRolesPage(query)
    return {
      ...page,
      items: page.items.map((role) => ({
        id: role.id,
        label: role.name,
        description: role.description || undefined,
      })),
    }
  }
})
const fetchPolicies = async (query: IamAuthorizationOptionQuery) => {
  const page = await ramService.listPoliciesPage(query)
  return {
    ...page,
    items: page.items.map((policy) => ({
      id: policy.id,
      label: policy.name,
      description: policy.description,
      highRisk: iamAuthorizationPolicyHighRisk(policy),
    })),
  }
}
const fetchGroups = async (query: IamAuthorizationOptionQuery) => {
  const page = await ramService.listResourceGroupPage(query)
  return {
    ...page,
    items: page.items.map((group) => ({
      id: group.id,
      label: group.name,
      description: group.description || undefined,
    })),
  }
}
watch(principalType, () => {
  principals.value = []
})
watch(
  () => props.selectedResourceGroup,
  (group) => {
    if (group && !locked.value) {
      scopeType.value = 'resource-group'
      groups.value = [{ id: group.id, label: group.id }]
    }
  },
  { immediate: true },
)
let disposed = false
const create = async () => {
  if (busy.value || (!batch.pending.value && !complete.value)) return
  const snapshot = batch.pending.value ?? requests()
  confirming.value = true
  try {
    await ElMessageBox.confirm(
      i18ns.t('RamManagement.authorizationConfirm', { count: snapshot.length }),
      i18ns.t('RamManagement.scopedCreateAuthorization'),
      { type: highRisk.value ? 'warning' : 'info' },
    )
  } catch {
    return
  } finally {
    confirming.value = false
  }
  if (disposed) return
  const before = batch.pending.value ? batch.completed.value : 0
  try {
    if (await batch.run(snapshot)) {
      principals.value = []
      policies.value = []
    }
  } catch (error) {
    showRequestErrorNotice(error, i18ns.t('RamManagement.authorizationPartialFailure'))
  } finally {
    if (!disposed && batch.completed.value > before) emit('created')
  }
}
const discard = () => {
  batch.discard()
  principals.value = []
  policies.value = []
}
onBeforeUnmount(() => {
  disposed = true
  batch.dispose()
})
</script>
<style scoped>
.authorization-form {
  display: grid;
  gap: 16px;
}
.authorization-boundary,
.authorization-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
}
.authorization-boundary .el-form-item {
  flex: 1;
  min-width: 180px;
  margin-bottom: 0;
}
.authorization-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.authorization-summary {
  margin: 0;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}
code {
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  .authorization-columns {
    grid-template-columns: 1fr;
  }
}
</style>
