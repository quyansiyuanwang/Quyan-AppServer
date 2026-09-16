// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProductConsoleShell from '@/views/products/components/ProductConsoleShell.vue'

const { catalogMock, listInstancesMock, listSubjectsMock, listKeysMock, messageErrorMock } =
  vi.hoisted(() => ({
    catalogMock: vi.fn(),
    listInstancesMock: vi.fn(),
    listSubjectsMock: vi.fn(),
    listKeysMock: vi.fn(),
    messageErrorMock: vi.fn(),
  }))

vi.mock('@/composables/usePageDevice', async () => {
  const { ref } = await import('vue')
  return {
    usePageDevice: () => ({ isDesktop: ref(false), isMobile: ref(true) }),
  }
})

vi.mock('@/composables/useMobileTableCardLabels', () => ({
  useMobileTableCardLabels: vi.fn(),
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({ hasPermission: () => true }),
}))

vi.mock('@/service/developerProductService', () => ({
  developerProductService: {
    catalog: catalogMock,
    listInstances: listInstancesMock,
    listSubjects: listSubjectsMock,
    listKeys: listKeysMock,
  },
}))

vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: { error: messageErrorMock, success: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

vi.mock('@/locales', () => ({
  i18ns: {
    t: (key: string) => key,
    locale: 'zh-CN',
  },
}))

const ElDrawerStub = defineComponent({
  name: 'ElDrawer',
  props: {
    modelValue: Boolean,
    direction: String,
    size: String,
    modalClass: String,
    title: String,
  },
  template: `
    <div
      class="el-drawer-stub"
      :data-direction="direction"
      :data-size="size"
      :data-modal-class="modalClass"
    >
      <slot />
    </div>
  `,
})

const mountOptions = {
  global: {
    directives: { loading: {} },
    stubs: {
      'el-alert': { template: '<div>{{ title }}<slot /></div>', props: ['title'] },
      'el-button': { template: '<button><slot /></button>' },
      'el-empty': { template: '<div />' },
      'el-table': { template: '<div><slot /></div>' },
      'el-table-column': { template: '<div />' },
      'el-drawer': ElDrawerStub,
      'el-tag': { template: '<span><slot /></span>' },
      'el-dialog': { template: '<div><slot /><slot name="footer" /></div>' },
      'el-form': { template: '<form><slot /></form>' },
      'el-form-item': { template: '<div><slot /></div>' },
      'el-input': { template: '<input />' },
      'el-select': { template: '<select><slot /></select>' },
      'el-option': { template: '<option />' },
      'el-checkbox-group': { template: '<div><slot /></div>' },
      'el-checkbox': { template: '<label><slot /></label>' },
      'el-date-picker': { template: '<input />' },
    },
  },
}

describe('ProductConsoleShell mobile layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    catalogMock.mockResolvedValue([])
    listInstancesMock.mockResolvedValue([])
    listSubjectsMock.mockResolvedValue([])
    listKeysMock.mockResolvedValue([])
  })

  it('uses full-width bottom drawer and the shared mobile table-card adapter', async () => {
    const wrapper = mount(ProductConsoleShell, {
      ...mountOptions,
      props: {
        product: 'short_link',
        title: 'Short links',
        description: 'Manage short links',
        actions: [],
      },
    })
    await flushPromises()

    expect(wrapper.get('main').classes()).toEqual(
      expect.arrayContaining(['mobile-page', 'mobile-table-cards']),
    )

    const drawer = wrapper.get('.el-drawer-stub')
    expect(drawer.attributes('data-direction')).toBe('btt')
    expect(drawer.attributes('data-size')).toBe('92%')
    expect(drawer.attributes('data-modal-class')).toBe('product-console-drawer-overlay')
  })
})
