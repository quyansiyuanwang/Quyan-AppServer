// @vitest-environment jsdom
import { shallowMount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Permission } from '@quyan/shared'
import RamIamPageControls from '@/views/management/ram-management/components/RamIamPageControls.vue'

const createContext = () => ({
  groupList: ref([]),
  loading: ref(false),
  keyword: ref(''),
  showRamGroups: ref(false),
  pagination: ref({ page: 2, pageSize: 10 }),
  displayTotal: ref(0),
  totalKnown: ref(false),
  hasMore: ref(true),
  handleCreate: vi.fn(),
  handleRefresh: vi.fn(),
  handleSearch: vi.fn(),
  handleEdit: vi.fn(),
  handleEditPermissions: vi.fn(),
  handleDelete: vi.fn(),
  handlePageChange: vi.fn(),
  handlePageSizeChange: vi.fn(),
  Permission,
})
let context: ReturnType<typeof createContext>
vi.mock('@/views/management/group-management/context', () => ({
  useGroupManagementContext: () => context,
}))
import Desktop from '@/views/management/group-management/components/GroupManagementDesktop.vue'
import Mobile from '@/views/management/group-management/components/GroupManagementMobile.vue'

beforeEach(() => {
  context = createContext()
})

describe.each([
  ['desktop', Desktop],
  ['mobile', Mobile],
] as const)('group management %s pagination', (_name, component) => {
  it('updates the page before requesting the previous and next pages', () => {
    const wrapper = shallowMount(component)
    try {
      const controls = wrapper.findComponent(RamIamPageControls)
      const pages: number[] = []
      context.handlePageChange.mockImplementation(() => pages.push(context.pagination.value.page))
      controls.vm.$emit('previous')
      expect(context.pagination.value.page).toBe(1)
      controls.vm.$emit('next')
      expect(context.pagination.value.page).toBe(2)
      expect(pages).toEqual([1, 2])
    } finally {
      wrapper.unmount()
    }
  })

  it('updates the page size before requesting a new first page', () => {
    const wrapper = shallowMount(component)
    try {
      let requestedSize = 0
      context.handlePageSizeChange.mockImplementation(() => {
        requestedSize = context.pagination.value.pageSize
        context.pagination.value.page = 1
      })
      wrapper.findComponent(RamIamPageControls).vm.$emit('size', 50)
      expect(requestedSize).toBe(50)
      expect(context.pagination.value).toEqual({ page: 1, pageSize: 50 })
      expect(context.handlePageSizeChange).toHaveBeenCalledOnce()
    } finally {
      wrapper.unmount()
    }
  })
})
