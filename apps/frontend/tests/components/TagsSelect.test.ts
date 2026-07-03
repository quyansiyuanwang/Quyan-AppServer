import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/locales', () => ({
  i18ns: {
    t: (key: string) => key,
  },
}))

import TagsSelect from '@/components/common/TagsSelect.vue'

const ElSelectStub = defineComponent({
  name: 'ElSelect',
  props: {
    modelValue: {
      type: Array,
      required: false,
    },
  },
  emits: ['update:modelValue'],
  template: '<div class="el-select-stub"><slot name="header" /><slot /></div>',
})

const ElCheckboxStub = defineComponent({
  name: 'ElCheckbox',
  props: {
    modelValue: {
      type: Boolean,
      required: false,
    },
    indeterminate: {
      type: Boolean,
      required: false,
    },
  },
  emits: ['change'],
  template:
    '<button class="check-all" @click="$emit(\'change\', !modelValue)"><slot /></button>',
})

const ElOptionStub = defineComponent({
  name: 'ElOption',
  props: {
    label: {
      type: String,
      required: false,
    },
    value: {
      type: String,
      required: false,
    },
  },
  template: '<div class="option-stub">{{ label }}</div>',
})

const mountTagsSelect = (modelValue: string[], allTags: string[]) =>
  mount(TagsSelect, {
    props: {
      modelValue,
      allTags,
    },
    global: {
      stubs: {
        'el-select': ElSelectStub,
        'el-checkbox': ElCheckboxStub,
        'el-option': ElOptionStub,
        ElSelect: ElSelectStub,
        ElCheckbox: ElCheckboxStub,
        ElOption: ElOptionStub,
      },
    },
  })

describe('TagsSelect', () => {
  it('selects all options when check-all is clicked from partial/empty state', async () => {
    const wrapper = mountTagsSelect([], ['A', 'B'])

    await wrapper.find('.check-all').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['A', 'B']])
  })

  it('clears all options when check-all is clicked from all-selected state', async () => {
    const wrapper = mountTagsSelect(['A', 'B'], ['A', 'B'])

    await wrapper.find('.check-all').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([[]])
  })

  it('forwards model updates from select component', async () => {
    const wrapper = mountTagsSelect(['A'], ['A', 'B'])

    wrapper.getComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', ['B'])
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['B']])
  })
})
