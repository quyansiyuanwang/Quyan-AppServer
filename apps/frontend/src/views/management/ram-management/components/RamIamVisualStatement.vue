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
        data-test="action-service"
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
        data-test="action-access-level"
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
      data-test="action-selection"
      multiple
      filterable
      allow-create
      default-first-option
      :disabled="disabled"
      :placeholder="i18ns.t('RamManagement.visualActions')"
      :aria-label="i18ns.t('RamManagement.visualActions')"
    >
      <el-option
        v-if="serviceActionPattern && statement.accessFilter === 'all'"
        :value="serviceActionPattern"
        :label="
          i18ns.t('RamManagement.visualAllServiceActions', { service: statement.serviceFilter })
        "
        data-test="service-action-wildcard"
      />
      <el-option-group
        v-for="group in actionGroups"
        :key="group.level"
        :label="i18ns.t(accessLevelLabels[group.level]) + ' (' + group.actions.length + ')'"
        :data-test="'action-options-' + group.level"
      >
        <el-option
          v-for="action in group.actions"
          :key="action.action"
          :value="action.action"
          :label="action.action"
        />
      </el-option-group>
    </el-select>
    <div class="action-categories">
      <el-button
        v-for="group in actionGroups"
        :key="group.level"
        :data-test="'action-category-' + group.level"
        :disabled="disabled || !statement.serviceFilter"
        @click="selectActionCategory(group.level)"
      >
        {{
          i18ns.t('RamManagement.visualSelectOperationCategory', {
            level: i18ns.t(accessLevelLabels[group.level]),
            count: group.actions.length,
          })
        }}
      </el-button>
    </div>
    <p data-test="selected-action-count">
      {{ i18ns.t('RamManagement.visualSelectedOperations', { count: statement.actions.length }) }}
    </p>
    <RamIamActionDependencies :actions="statement.actions" />
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
        :disabled="disabled || !accountOwnerId || !accountTargetAvailable"
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
        data-test="resource-type"
        filterable
        :disabled="disabled"
        :placeholder="i18ns.t('RamManagement.visualResourceType')"
      >
        <el-option v-for="type in resourceTypes" :key="type.id" :label="type.id" :value="type.id" />
      </el-select>
      <el-button
        data-test="add-resource"
        :disabled="disabled || !resourceTemplate"
        @click="addResource"
        >{{ i18ns.t('RamManagement.visualAddResource') }}</el-button
      >
    </div>
    <div v-if="selectedType" class="resource-builder">
      <label class="resource-field">
        <span>{{ i18ns.t('RamManagement.visualTrustedAccount') }}</span>
        <el-input data-test="resource-account" :model-value="resourceAccountId ?? ''" readonly />
      </label>
      <div v-for="field in resourceFields" :key="field" class="resource-field">
        <label :for="resourceInputId(field)">
          {{ i18ns.t('RamManagement.visualResourceIdentifier', { field }) }}
        </label>
        <el-input
          :id="resourceInputId(field)"
          v-model="identifierValues[field]"
          :data-test="'resource-identifier-' + field"
          :disabled="disabled || identifierWildcards[field]"
          :placeholder="'{' + field + '}'"
        />
        <el-checkbox
          v-model="identifierWildcards[field]"
          :data-test="'resource-wildcard-' + field"
          :disabled="disabled"
          :aria-label="i18ns.t('RamManagement.visualIdentifierWildcard', { field })"
          >{{ i18ns.t('RamManagement.visualIdentifierWildcard', { field }) }}</el-checkbox
        >
      </div>
    </div>
    <code v-if="resourceTemplate" data-test="resource-preview">{{ resourceTemplate }}</code>
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
import RamIamActionDependencies from './RamIamActionDependencies.vue'
import { computed, ref, watch, useId } from 'vue'
import { getIamConditionKey, iamServiceDefinitions } from '@quyan/shared'
import type { VisualCondition, VisualStatement } from '../iam-visual-policy'
import {
  visualConditionKeys,
  visualActionGroups,
  visualServiceActionPattern,
  VISUAL_ACCESS_LEVELS,
  visualResourceTemplate,
  visualResourceAccountId,
  visualResourceIdentifierFields,
  visualResourceTypes,
} from '../iam-visual-policy'
import { i18ns } from '@/locales'
const props = defineProps<{ accountOwnerId: string; disabled: boolean }>()
const statement = defineModel<VisualStatement>('statement', { required: true })
const services = iamServiceDefinitions()
const accessLevels = VISUAL_ACCESS_LEVELS
const accessLevelLabels = {
  Read: 'RamManagement.visualRead',
  Write: 'RamManagement.visualWrite',
  List: 'RamManagement.visualList',
} as const
const actionGroups = computed(() =>
  visualActionGroups(statement.value.serviceFilter, statement.value.accessFilter),
)
const serviceActionPattern = computed(() =>
  visualServiceActionPattern(statement.value.serviceFilter),
)
const selectActionCategory = (level: (typeof VISUAL_ACCESS_LEVELS)[number]) => {
  if (props.disabled || !statement.value.serviceFilter) return
  const group = actionGroups.value.find((group) => group.level === level)
  if (group)
    statement.value.actions = [
      ...new Set([...statement.value.actions, ...group.actions.map((action) => action.action)]),
    ]
}
const resourceTypes = computed(() => visualResourceTypes(statement.value.actions))
const conditionKeys = computed(() => visualConditionKeys(statement.value.actions))
const resourceTypeId = ref('')
const identifierValues = ref<Record<string, string>>({})
const identifierWildcards = ref<Record<string, boolean>>({})
const fieldIdPrefix = useId()
const resourceInputId = (field: string) => fieldIdPrefix + '-resource-' + field
const selectedType = computed(() =>
  resourceTypes.value.find((type) => type.id === resourceTypeId.value),
)
const resourceFields = computed(() =>
  selectedType.value ? visualResourceIdentifierFields(selectedType.value.id) : [],
)
const resourceAccountId = computed(() =>
  selectedType.value
    ? visualResourceAccountId(selectedType.value.id, props.accountOwnerId)
    : undefined,
)
const accountTargetAvailable = computed(() =>
  resourceTypes.value.some((type) => type.id === 'quyan/account'),
)
watch(resourceTypeId, () => {
  identifierValues.value = Object.fromEntries(resourceFields.value.map((field) => [field, '']))
  identifierWildcards.value = Object.fromEntries(
    resourceFields.value.map((field) => [field, false]),
  )
})
watch(resourceTypes, (types) => {
  if (!types.some((type) => type.id === resourceTypeId.value)) resourceTypeId.value = ''
})
const resourceTemplate = computed(() =>
  selectedType.value
    ? visualResourceTemplate(
        selectedType.value.id,
        props.accountOwnerId,
        Object.fromEntries(
          resourceFields.value.map((field) => [
            field,
            identifierWildcards.value[field] ? '*' : (identifierValues.value[field] ?? ''),
          ]),
        ),
      )
    : undefined,
)
const hasWildcard = computed(() =>
  [...statement.value.actions, statement.value.resourcesText].some((value) => value.includes('*')),
)
const setAccountScope = () => {
  if (!accountTargetAvailable.value) return
  const resource = visualResourceTemplate('quyan/account', props.accountOwnerId, {})
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
.action-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.resource-builder {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.resource-field {
  display: grid;
  align-content: start;
  gap: 6px;
}
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
