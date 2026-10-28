// @vitest-environment jsdom
import { computed, defineComponent, inject, provide, ref } from 'vue'
import type { ComputedRef } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useIamPolicyVersions } from '@/views/management/ram-management/useIamPolicyVersions'
import type { RamPolicyDto, RamPolicyVersionDto } from '@/client/types.gen'
const { listPolicyVersions, setDefaultPolicyVersion, confirm } = vi.hoisted(() => ({
  listPolicyVersions: vi.fn(),
  setDefaultPolicyVersion: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('@/service/ramService', () => ({
  ramService: { listPolicyVersions, setDefaultPolicyVersion },
}))
vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessageBox: { confirm } }))
vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))
let context: ReturnType<typeof useIamPolicyVersions> & {
  canUpdatePolicies: ReturnType<typeof ref<boolean>>
}
vi.mock('@/views/management/ram-management/context', () => ({
  useRamManagementContext: () => context,
}))
import RamIamPolicyVersions from '@/views/management/ram-management/components/RamIamPolicyVersions.vue'
const table = defineComponent({
  props: ['data'],
  setup(props) {
    provide(
      'rows',
      computed(() => props.data),
    )
    return {}
  },
  template: '<div><slot /></div>',
})
const column = defineComponent({
  props: ['prop'],
  setup() {
    return { rows: inject<ComputedRef<RamPolicyVersionDto[]>>('rows') }
  },
  template: '<div v-for="row in rows" :key="row.id"><slot :row="row">{{ row[prop] }}</slot></div>',
})
const button = defineComponent({
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
})
const pagination = defineComponent({
  props: ['currentPage', 'pageSize', 'total', 'disabled'],
  emits: ['update:currentPage'],
  template: `<button :disabled="disabled" @click="$emit('update:currentPage', currentPage + 1)">next-page {{ total }}</button>`,
})
const version: RamPolicyVersionDto = {
  id: 'v1',
  version: 1,
  isDefault: false,
  documentHash: 'b'.repeat(64),
  createdBy: 'owner',
  createTime: '',
  document: { Version: '1', Statement: { Effect: 'Deny', Action: '*', Resource: '*' } },
}
const policy: RamPolicyDto = {
  id: 'p1',
  accountOwnerId: 'owner',
  status: 1,
  name: 'history-policy',
  permissions: [],
  type: 'custom',
  createTime: '',
  updateTime: '',
}
describe('IAM version history interactions', () => {
  it('previews JSON, restores a historical default and requests the next server page', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined)
    context = {
      ...useIamPolicyVersions({ canUpdate: () => true, onChanged }),
      canUpdatePolicies: ref(true),
    }
    const page = {
      items: [version],
      total: 41,
      page: 1,
      pageSize: 20,
      defaultDocumentHash: 'a'.repeat(64),
    }
    listPolicyVersions.mockResolvedValue(page)
    confirm.mockResolvedValue(undefined)
    setDefaultPolicyVersion.mockResolvedValue(undefined)
    await context.openIamPolicyVersions(policy)
    const wrapper = mount(RamIamPolicyVersions, {
      global: {
        stubs: {
          'el-drawer': defineComponent({ template: '<div><slot /></div>' }),
          'el-table': table,
          'el-table-column': column,
          'el-button': button,
          'el-pagination': pagination,
          'el-alert': defineComponent({ props: ['title'], template: '<div>{{ title }}</div>' }),
          'el-tag': defineComponent({ template: '<span><slot /></span>' }),
        },
      },
    })
    const findButton = (text: string) => wrapper.findAll('button').find((b) => b.text() === text)!
    expect(wrapper.text()).toContain('history-policy')
    await findButton('RamManagement.iamViewDocument').trigger('click')
    expect(wrapper.get('pre').text()).toContain('"Effect": "Deny"')
    listPolicyVersions.mockResolvedValueOnce({ ...page, items: [{ ...version, isDefault: true }] })
    await findButton('RamManagement.iamRestoreVersion').trigger('click')
    await flushPromises()
    expect(setDefaultPolicyVersion).toHaveBeenCalledWith('p1', {
      versionId: 'v1',
      expectedDocumentHash: page.defaultDocumentHash,
    })
    expect(onChanged).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('RamManagement.iamDefaultVersion')
    expect(wrapper.find('pre').exists()).toBe(false)
    await findButton('next-page 41').trigger('click')
    await flushPromises()
    expect(listPolicyVersions).toHaveBeenLastCalledWith('p1', { page: 2, pageSize: 20 })
    wrapper.unmount()
  })
})
