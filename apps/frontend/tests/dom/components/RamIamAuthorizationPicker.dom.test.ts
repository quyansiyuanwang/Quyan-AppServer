// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
import Picker from '@/views/management/ram-management/components/RamIamAuthorizationPicker.vue'
import type { IamAuthorizationOption } from '@/views/management/ram-management/iam-authorization-selection'
const stubs = {
  'el-input': defineComponent({
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template:
      '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  }),
  'el-button': { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
  'el-checkbox': defineComponent({
    props: ['modelValue', 'disabled'],
    emits: ['change'],
    template:
      '<label><input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit(\'change\', $event.target.checked)" /><slot /></label>',
  }),
  'el-alert': { props: ['title'], template: '<p>{{ title }}</p>' },
  'el-tag': { template: '<span><slot /></span>' },
  RamIamPageControls: defineComponent({
    props: ['hasNext', 'loading', 'page'],
    emits: ['next', 'previous'],
    template:
      '<div><button data-test="next" :disabled="loading || !hasNext" @click="$emit(\'next\')">Next</button><button data-test="previous" :disabled="loading || page <= 1" @click="$emit(\'previous\')">Previous</button></div>',
  }),
}
const option = (id: string) => ({ id, label: id })
const page = (items: IamAuthorizationOption[], number = 1, hasNext = false) => ({
  items,
  page: number,
  pageSize: 50,
  hasNext,
})
const mountPicker = (fetchPage: ReturnType<typeof vi.fn>) => {
  const wrapper = mount(Picker, {
    props: {
      title: 'Principals',
      disabled: false,
      multiple: true,
      modelValue: [],
      fetchPage,
      'onUpdate:modelValue': (items: IamAuthorizationOption[]) => {
        void wrapper.setProps({ modelValue: items })
      },
    },
    global: { stubs },
  })
  return wrapper
}
describe('IAM authorization paginated picker', () => {
  it('keeps selections across pages and sends literal server search, including empty candidate pages', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page([option('one')], 1, true))
      .mockResolvedValueOnce(page([option('two')], 2))
      .mockResolvedValueOnce(page([], 1, true))
      .mockResolvedValueOnce(page([option('three')], 2))
    const wrapper = mountPicker(fetch)
    await flushPromises()
    await wrapper.get('[data-test="pick-one"] input').setValue(true)
    await wrapper.get('[data-test="next"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="pick-two"] input').setValue(true)
    expect(wrapper.props('modelValue').map((item) => item.id)).toEqual(['one', 'two'])
    await wrapper.get('input:not([type="checkbox"])').setValue('specific resource')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'RamManagement.authorizationSearchButton')!
      .trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith({ page: 1, pageSize: 50, keyword: 'specific resource' })
    expect(wrapper.get('[data-test="next"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-test="next"]').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith({ page: 2, pageSize: 50, keyword: 'specific resource' })
    expect(wrapper.props('modelValue').map((item) => item.id)).toEqual(['one', 'two'])
    wrapper.unmount()
  })
  it('clears unsafe old selections on a failed page and allows explicit retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page([option('one')], 1, true))
      .mockRejectedValueOnce(Error('fixture denied'))
      .mockResolvedValueOnce(page([option('two')]))
    const wrapper = mountPicker(fetch)
    await flushPromises()
    await wrapper.get('[data-test="pick-one"] input').setValue(true)
    await wrapper.get('[data-test="next"]').trigger('click')
    await flushPromises()
    expect(wrapper.props('modelValue')).toEqual([])
    expect(wrapper.text()).toContain('RamManagement.scopedLoadFailed')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'RamManagement.authorizationSearchButton')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pick-two"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('discards an earlier response and clears selection when principal sources change', async () => {
    let finish!: (value: ReturnType<typeof page>) => void
    const old = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const wrapper = mountPicker(old)
    await flushPromises()
    const current = vi.fn().mockResolvedValue(page([option('role')]))
    await wrapper.setProps({ fetchPage: current, modelValue: [option('old-user')] })
    await flushPromises()
    finish(page([option('old-user')]))
    await flushPromises()
    expect(wrapper.props('modelValue')).toEqual([])
    expect(wrapper.find('[data-test="pick-role"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pick-old-user"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
