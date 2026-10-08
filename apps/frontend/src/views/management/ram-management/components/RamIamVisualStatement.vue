<template>
  <div class="statement-form">
    <div class="field-row">
      <el-input
        v-model="statement.sid"
        :disabled="disabled"
        :placeholder="i18ns.t('RamManagement.visualSid')"
        :aria-label="i18ns.t('RamManagement.visualSid')"
      />
      <el-select
        v-model="statement.effect"
        :disabled="disabled"
        :aria-label="i18ns.t('RamManagement.visualEffect')"
      >
        <el-option label="Allow" value="Allow" /><el-option label="Deny" value="Deny" />
      </el-select>
    </div>
    <div class="field-row">
      <el-select
        v-model="statement.serviceFilter"
        filterable
        clearable
        :disabled="disabled"
        :placeholder="i18ns.t('RamManagement.visualService')"
      >
        <el-option
          v-for="service in services"
          :key="service.code"
          :value="service.code"
          :label="service.name"
        />
      </el-select>
      <el-select
        v-model="statement.accessFilter"
        :disabled="disabled"
        :aria-label="i18ns.t('RamManagement.visualAccessLevel')"
      >
        <el-option :label="i18ns.t('RamManagement.visualAllOperations')" value="all" />
        <el-option
          v-for="level in accessLevels"
          :key="level"
          :label="i18ns.t(accessLevelLabels[level])"
          :value="level"
        />
      </el-select>
    </div>
    <el-select
      v-model="statement.actions"
      multiple
      filterable
      allow-create
      default-first-option
      :disabled="disabled"
      :placeholder="i18ns.t('RamManagement.visualActions')"
      :aria-label="i18ns.t('RamManagement.visualActions')"
    >
      <el-option
        v-for="action in filteredActions"
        :key="action.action"
        :value="action.action"
        :label="action.action"
      />
    </el-select>
    <el-alert
      v-if="statement.effect === 'Deny'"
      :title="i18ns.t('RamManagement.iamDenyWarning')"
      type="warning"
      :closable="false"
    />
    <p>{{ i18ns.t('RamManagement.visualResources') }}</p>
    <div class="field-row">
      <el-button
        data-test="account-scope"
        :disabled="disabled || !accountOwnerId"
        @click="setAccountScope"
        >{{ i18ns.t('RamManagement.visualAccountScope') }}</el-button
      >
      <el-button
        data-test="wildcard-scope"
        :disabled="disabled"
        @click="statement.resourcesText = '*'"
        >{{ i18ns.t('RamManagement.visualAllResources') }}</el-button
      >
    </div>
    <div class="field-row">
      <el-select
        v-model="resourceTypeId"
        filterable
        :disabled="disabled"
        :placeholder="i18ns.t('RamManagement.visualResourceType')"
      >
        <el-option v-for="type in resourceTypes" :key="type.id" :label="type.id" :value="type.id" />
      </el-select>
      <el-input
        v-if="selectedType?.identifierSegments === 2"
        v-model="parentId"
        :disabled="disabled"
        :placeholder="i18ns.t('RamManagement.visualParentId')"
      />
      <el-input
        v-if="selectedType?.identifierSegments"
        v-model="resourceId"
        :disabled="disabled"
        :placeholder="i18ns.t('RamManagement.visualResourceId')"
      />
      <el-button
        data-test="add-resource"
        :disabled="disabled || !resourceTemplate"
        @click="addResource"
        >{{ i18ns.t('RamManagement.visualAddResource') }}</el-button
      >
    </div>
    <code v-if="resourceTemplate">{{ resourceTemplate }}</code>
    <el-input
      v-model="statement.resourcesText"
      type="textarea"
      :rows="3"
      :disabled="disabled"
      :placeholder="i18ns.t('RamManagement.visualResourceLines')"
      :aria-label="i18ns.t('RamManagement.visualResources')"
    />
    <el-alert
      v-if="!accountOwnerId"
      :title="i18ns.t('RamManagement.visualAccountUnavailable')"
      type="warning"
      :closable="false"
    />
    <el-alert
      v-if="hasWildcard"
      :title="i18ns.t('RamManagement.iamWildcardWarning')"
      type="warning"
      :closable="false"
    />
    <p>{{ i18ns.t('RamManagement.visualConditionHelp') }}</p>
    <div v-for="(condition, index) in statement.conditions" :key="index" class="condition-row">
      <el-select
        v-model="condition.key"
        :disabled="disabled"
        :placeholder="i18ns.t('RamManagement.visualConditionKey')"
        @change="selectConditionKey(condition)"
      >
        <el-option v-for="key in conditionKeys" :key="key.key" :label="key.key" :value="key.key" />
      </el-select>
      <el-select
        v-model="condition.operator"
        :disabled="disabled"
        :placeholder="i18ns.t('RamManagement.visualOperator')"
      >
        <el-option
          v-for="operator in conditionOperators(condition.key)"
          :key="operator"
          :label="operator"
          :value="operator"
        />
      </el-select>
      <el-input
        v-model="condition.valuesText"
        :disabled="disabled"
        :placeholder="i18ns.t('RamManagement.visualConditionValues')"
        :aria-label="i18ns.t('RamManagement.visualConditionValues')"
      />
      <el-button :disabled="disabled" @click="statement.conditions.splice(index, 1)">{{
        i18ns.t('RamManagement.visualRemoveCondition')
      }}</el-button>
    </div>
    <el-button
      data-test="add-condition"
      :disabled="disabled || !conditionKeys.length"
      @click="addCondition"
      >{{ i18ns.t('RamManagement.visualAddCondition') }}</el-button
    >
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { IAM_ACTION_DEFINITIONS, getIamConditionKey, iamServiceDefinitions } from '@quyan/shared'
import type { VisualCondition, VisualStatement } from '../iam-visual-policy'
import {
  visualConditionKeys,
  visualResourceTemplate,
  visualResourceTypes,
} from '../iam-visual-policy'
import { i18ns } from '@/locales'
const props = defineProps<{ accountOwnerId: string; disabled: boolean }>()
const statement = defineModel<VisualStatement>('statement', { required: true })
const services = iamServiceDefinitions()
const accessLevels = ['Read', 'Write', 'List'] as const
const accessLevelLabels = {
  Read: 'RamManagement.visualRead',
  Write: 'RamManagement.visualWrite',
  List: 'RamManagement.visualList',
} as const
const filteredActions = computed(() =>
  IAM_ACTION_DEFINITIONS.filter(
    (action) =>
      (!statement.value.serviceFilter || action.service === statement.value.serviceFilter) &&
      (statement.value.accessFilter === 'all' ||
        action.accessLevel === statement.value.accessFilter),
  ),
)
const resourceTypes = computed(() => visualResourceTypes(statement.value.actions))
const conditionKeys = computed(() => visualConditionKeys(statement.value.actions))
const resourceTypeId = ref(''),
  resourceId = ref(''),
  parentId = ref('')
const selectedType = computed(() =>
  resourceTypes.value.find((type) => type.id === resourceTypeId.value),
)
const resourceTemplate = computed(() =>
  selectedType.value
    ? visualResourceTemplate(
        selectedType.value.id,
        props.accountOwnerId,
        resourceId.value,
        parentId.value,
      )
    : undefined,
)
const hasWildcard = computed(() =>
  [...statement.value.actions, statement.value.resourcesText].some((value) => value.includes('*')),
)
const setAccountScope = () => {
  const resource = visualResourceTemplate('quyan/account', props.accountOwnerId, '')
  if (resource) statement.value.resourcesText = resource
}
const addResource = () => {
  if (!resourceTemplate.value) return
  statement.value.resourcesText = [
    ...new Set([
      ...statement.value.resourcesText.split(/\r?\n/).filter(Boolean),
      resourceTemplate.value,
    ]),
  ].join('\n')
}
const conditionOperators = (key: string) => getIamConditionKey(key)?.operators ?? []
const selectConditionKey = (condition: VisualCondition) => {
  if (!conditionOperators(condition.key).includes(condition.operator))
    condition.operator = conditionOperators(condition.key)[0]!
}
const addCondition = () => {
  const key = conditionKeys.value[0]
  if (key)
    statement.value.conditions.push({ key: key.key, operator: key.operators[0]!, valuesText: '' })
}
</script>
<style scoped>
.statement-form {
  display: grid;
  gap: 12px;
}
.field-row,
.condition-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.field-row > *,
.condition-row > * {
  flex: 1;
  min-width: 140px;
}
code {
  overflow-wrap: anywhere;
}
</style>
