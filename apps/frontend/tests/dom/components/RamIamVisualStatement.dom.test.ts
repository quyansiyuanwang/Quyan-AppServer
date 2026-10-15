// @vitest-environment jsdom
import { defineComponent, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/locales', () => ({
  i18ns: {
    t: (key: string, values?: Record<string, string>) =>
      key + (values?.field ? ':' + values.field : ''),
  },
}))
import View from '@/views/management/ram-management/components/RamIamVisualStatement.vue'
import {
  newVisualStatement,
  visualActionGroups,
  type VisualStatement,
} from '@/views/management/ram-management/iam-visual-policy'
const Input = defineComponent({
  props: ['modelValue', 'disabled', 'readonly'],
  emits: ['update:modelValue'],
  template:
    '<input :value="modelValue" :disabled="disabled" :readonly="readonly" @input="$emit(\'update:modelValue\', $event.target.value)" />',
})
const Select = defineComponent({
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template:
    '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
})
const Option = defineComponent({
  props: ['value', 'label'],
  template: '<option :value="value">{{ label }}</option>',
})
const OptionGroup = defineComponent({
  props: ['label'],
  template: '<optgroup :label="label"><slot /></optgroup>',
})
const Checkbox = defineComponent({
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template:
    '<input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
})
const Button = defineComponent({
  props: ['disabled'],
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
})
let view: VueWrapper | undefined
const mountView = (
  row: VisualStatement = { ...newVisualStatement(), actions: ['*'] },
  accountOwnerId = 'owner',
) => {
  view = mount(View, {
    props: { statement: row, accountOwnerId, disabled: false },
    global: {
      stubs: {
        'el-input': Input,
        'el-select': Select,
        'el-option': Option,
        'el-option-group': OptionGroup,
        'el-checkbox': Checkbox,
        'el-button': Button,
      },
    },
  })
  return view
}
const choose = async (type: string) => {
  await view!.get('[data-test="resource-type"]').setValue(type)
  await nextTick()
}
const input = (field: string) => view!.get('[data-test="resource-identifier-' + field + '"]')
afterEach(() => {
  view?.unmount()
  view = undefined
})
describe('IAM catalog-driven resource builder', () => {
  it('renders all three identifiers and enables Add only after every field is supplied', async () => {
    const row = { ...newVisualStatement(), actions: ['*'] }
    mountView(row)
    await choose('monthly-pass/usage')
    expect(view!.findAll('[data-test^="resource-identifier-"]')).toHaveLength(3)
    expect(view!.get('[data-test="add-resource"]').attributes('disabled')).toBeDefined()
    await input('ancestorId').setValue('user')
    await input('parentId').setValue('pass')
    await input('resourceId').setValue('usage')
    expect(view!.get('[data-test="resource-preview"]').text()).toBe(
      'acs:monthly-pass:*:owner:usage/user/pass/usage',
    )
    expect(view!.get('[data-test="add-resource"]').attributes('disabled')).toBeUndefined()
    await view!.get('[data-test="add-resource"]').trigger('click')
    expect(row.resourcesText).toBe('acs:monthly-pass:*:owner:usage/user/pass/usage')
  })
  it('uses explicit per-identifier wildcards and preserves exact values when disabled', async () => {
    mountView()
    await choose('platform/relay-token')
    await input('userId').setValue('exact-user')
    await input('resourceId').setValue('token')
    expect(view!.get('[data-test="resource-account"]').attributes('readonly')).toBeDefined()
    expect((view!.get('[data-test="resource-account"]').element as HTMLInputElement).value).toBe(
      'platform',
    )
    await view!.get('[data-test="resource-wildcard-userId"]').setValue(true)
    expect(input('userId').attributes('disabled')).toBeDefined()
    expect(view!.get('[data-test="resource-preview"]').text()).toBe(
      'acs:platform:*:platform:relay-token/*/token',
    )
    await view!.get('[data-test="resource-wildcard-userId"]').setValue(false)
    expect((input('userId').element as HTMLInputElement).value).toBe('exact-user')
    expect(view!.get('[data-test="resource-preview"]').text()).toBe(
      'acs:platform:*:platform:relay-token/exact-user/token',
    )
  })
  it('resets unfinished identifier inputs on type changes without removing existing policy ARNs', async () => {
    const row = {
      ...newVisualStatement(),
      actions: ['*'],
      resourcesText: 'acs:quyan:*:owner:user/retained',
    }
    mountView(row)
    await choose('platform/relay-token')
    await input('userId').setValue('unfinished')
    await input('resourceId').setValue('token')
    await choose('relay/provider')
    expect((input('parentId').element as HTMLInputElement).value).toBe('')
    expect((input('resourceId').element as HTMLInputElement).value).toBe('')
    expect(view!.find('[data-test="resource-preview"]').exists()).toBe(false)
    expect(row.resourcesText).toBe('acs:quyan:*:owner:user/retained')
  })
  it('clears an incompatible builder when selected actions change and disables incompatible account targets', async () => {
    mountView()
    await choose('monthly-pass/usage')
    await view!.setProps({
      statement: { ...newVisualStatement(), actions: ['quyan:relay:ListProbeAccounts'] },
    })
    await nextTick()
    expect(view!.findAll('[data-test^="resource-identifier-"]')).toHaveLength(0)
    expect(view!.get('[data-test="account-scope"]').attributes('disabled')).toBeDefined()
  })
  it('cannot build platform resources without a trusted account context', async () => {
    mountView(undefined, '')
    await choose('platform/relay-token')
    await input('userId').setValue('user')
    await input('resourceId').setValue('token')
    expect(view!.find('[data-test="resource-preview"]').exists()).toBe(false)
    expect(view!.get('[data-test="add-resource"]').attributes('disabled')).toBeDefined()
  })
  it('disables identifier changes wildcard toggles and adding when the editor is disabled', async () => {
    mountView()
    await choose('relay/provider')
    await input('parentId').setValue('user')
    await input('resourceId').setValue('provider')
    await view!.setProps({ disabled: true })
    expect(input('parentId').attributes('disabled')).toBeDefined()
    expect(
      view!.get('[data-test="resource-wildcard-parentId"]').attributes('disabled'),
    ).toBeDefined()
    expect(view!.get('[data-test="add-resource"]').attributes('disabled')).toBeDefined()
  })
})

describe('IAM service and operation categories', () => {
  it('shows category counts and adds only exact operations in the selected category', async () => {
    const row = {
      ...newVisualStatement(),
      actions: ['quyan:ram:ReadUser'],
      effect: 'Deny' as const,
    }
    mountView(row)
    await view!.get('[data-test="action-service"]').setValue('relay')
    const groups = visualActionGroups('relay')
    expect(view!.findAll('[data-test^="action-options-"]')).toHaveLength(groups.length)
    const read = groups.find((group) => group.level === 'Read')!
    expect(view!.get('[data-test="action-options-Read"]').attributes('label')).toContain(
      '(' + read.actions.length + ')',
    )
    await view!.get('[data-test="action-category-Read"]').trigger('click')
    expect(row.actions).toEqual([
      'quyan:ram:ReadUser',
      ...read.actions.map((action) => action.action),
    ])
    expect(row.effect).toBe('Deny')
    await view!.get('[data-test="action-category-Read"]').trigger('click')
    expect(new Set(row.actions).size).toBe(row.actions.length)
    expect(row.actions.some((action) => action.endsWith('*'))).toBe(false)
  })
  it('offers a service wildcard explicitly only when all operation levels are visible', async () => {
    const row = newVisualStatement()
    mountView(row)
    await view!.get('[data-test="action-service"]').setValue('relay')
    expect(view!.get('[data-test="service-action-wildcard"]').attributes('value')).toBe(
      'quyan:relay:*',
    )
    expect(row.actions).toEqual([])
    await view!.get('[data-test="action-access-level"]').setValue('Read')
    expect(view!.find('[data-test="service-action-wildcard"]').exists()).toBe(false)
    expect(view!.find('[data-test="action-category-Write"]').exists()).toBe(false)
    expect(view!.find('[data-test="action-category-List"]').exists()).toBe(false)
  })
  it('keeps existing actions when service filters change and disables category selection without a service', async () => {
    const row = { ...newVisualStatement(), actions: ['quyan:ram:ReadUser'] }
    mountView(row)
    expect(view!.get('[data-test="action-category-Read"]').attributes('disabled')).toBeDefined()
    await view!.get('[data-test="action-service"]').setValue('relay')
    await view!.get('[data-test="action-service"]').setValue('ram')
    expect(row.actions).toEqual(['quyan:ram:ReadUser'])
    await view!.setProps({ disabled: true })
    expect(view!.get('[data-test="action-category-Read"]').attributes('disabled')).toBeDefined()
  })
})
