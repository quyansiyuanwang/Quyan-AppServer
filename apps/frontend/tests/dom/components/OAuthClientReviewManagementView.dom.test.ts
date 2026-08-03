// @vitest-environment jsdom
import { computed, defineComponent, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/locales'

const {
  listClientsForReviewMock,
  reviewClientMock,
  deleteClientForReviewMock,
  confirmMock,
  messageSuccessMock,
  messageErrorMock,
} = vi.hoisted(() => ({
  listClientsForReviewMock: vi.fn(),
  reviewClientMock: vi.fn(),
  deleteClientForReviewMock: vi.fn(),
  confirmMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  messageErrorMock: vi.fn(),
}))

vi.mock('@/service/oauthClientService', () => ({
  OAuthClientService: {
    getInstance: () => ({
      listClientsForReview: listClientsForReviewMock,
      reviewClient: reviewClientMock,
      deleteClientForReview: deleteClientForReviewMock,
    }),
  },
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    success: messageSuccessMock,
    error: messageErrorMock,
  },
  ElMessageBox: {
    confirm: confirmMock,
  },
}))

vi.mock('@element-plus/icons-vue', () => ({
  Refresh: defineComponent({ name: 'RefreshIcon', template: '<span />' }),
}))

import OAuthClientReviewManagementView from '@/views/settings/OAuthClientReviewManagementView.vue'

const ElCardStub = defineComponent({
  name: 'ElCard',
  template: '<div class="el-card-stub"><slot name="header" /><slot /></div>',
})

const ElTableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, default: () => [] } },
  setup(props) {
    provide('tableRows', computed(() => props.data as any[]))
  },
  template: '<div class="el-table-stub"><slot /></div>',
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumn',
  setup() {
    const rows = inject<any>('tableRows', ref([]))
    return { rows }
  },
  template:
    '<div class="el-table-column-stub"><template v-for="(row, index) in rows" :key="index"><slot :row="row" /></template></div>',
})

const ElDialogStub = defineComponent({
  name: 'ElDialog',
  props: { modelValue: { type: Boolean, default: false } },
  template: '<div class="el-dialog-stub" v-if="modelValue"><slot /><slot name="footer" /></div>',
})

const ElFormStub = defineComponent({ name: 'ElForm', template: '<form><slot /></form>' })
const ElFormItemStub = defineComponent({ name: 'ElFormItem', template: '<div><slot /></div>' })
const ElTagStub = defineComponent({ name: 'ElTag', template: '<span><slot /></span>' })
const ElOptionStub = defineComponent({ name: 'ElOption', template: '<option><slot /></option>' })
const ElEmptyStub = defineComponent({ name: 'ElEmpty', template: '<div class="empty-stub"></div>' })
const ElPaginationStub = defineComponent({ name: 'ElPagination', template: '<div class="pagination-stub"></div>' })

const ElInputStub = defineComponent({
  name: 'ElInput',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'keyup.enter', 'clear'],
  methods: {
    onInput(event: Event) {
      this.$emit('update:modelValue', (event.target as HTMLInputElement)?.value ?? '')
    },
  },
  template: '<input class="el-input-stub" :value="modelValue" @input="onInput" />',
})

const ElSelectStub = defineComponent({
  name: 'ElSelect',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'change'],
  template: '<select class="el-select-stub"><slot /></select>',
})

const ElButtonStub = defineComponent({
  name: 'ElButton',
  emits: ['click'],
  template: '<button class="el-button-stub" @click="$emit(\'click\')"><slot /></button>',
})

const mountView = () =>
  mount(OAuthClientReviewManagementView, {
    global: {
      plugins: [i18n],
      directives: {
        loading: {},
      },
      stubs: {
        'el-card': ElCardStub,
        'el-table': ElTableStub,
        'el-table-column': ElTableColumnStub,
        'el-dialog': ElDialogStub,
        'el-form': ElFormStub,
        'el-form-item': ElFormItemStub,
        'el-tag': ElTagStub,
        'el-option': ElOptionStub,
        'el-empty': ElEmptyStub,
        'el-pagination': ElPaginationStub,
        'el-input': ElInputStub,
        'el-select': ElSelectStub,
        'el-button': ElButtonStub,
      },
    },
  })

const createRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'oauth-client-1',
  userId: 'user-1',
  reviewerUserId: 'reviewer-1',
  ownerUsername: 'owner',
  reviewerUsername: 'reviewer',
  name: 'Example App',
  description: 'desc',
  clientId: 'oauth_client_id',
  clientSecretPreview: 'oauths_ab****1234',
  clientType: 'confidential',
  reviewStatus: 'pending',
  reviewComment: 'existing comment',
  submittedAt: '2026-06-02T12:00:00.000Z',
  reviewedAt: '2026-06-02T12:10:00.000Z',
  grantTypes: ['authorization_code'],
  redirectUris: ['https://example.com/callback'],
  scopes: ['profile'],
  isPkceRequired: true,
  accessTokenLifetime: 3600,
  refreshTokenLifetime: 2592000,
  createTime: '2026-06-02T11:00:00.000Z',
  updateTime: '2026-06-02T12:10:00.000Z',
  hasClientSecret: true,
  ...overrides,
})

describe('OAuthClientReviewManagementView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listClientsForReviewMock.mockResolvedValue({
      data: {
        items: [createRow()],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    reviewClientMock.mockResolvedValue({ code: 0 })
    deleteClientForReviewMock.mockResolvedValue({ code: 0 })
    confirmMock.mockResolvedValue(true)
  })

  it('loads review items on mount', async () => {
    mountView()
    await flushPromises()

    expect(listClientsForReviewMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      keyword: undefined,
      reviewStatus: undefined,
    })
  })

  it('submits trimmed review comment for rejection', async () => {
    const wrapper = mountView()
    await flushPromises()

    const buttons = wrapper.findAll('button.el-button-stub')
    const rejectButton = buttons.find((button) => button.text().includes('拒绝'))
    expect(rejectButton).toBeDefined()
    await rejectButton!.trigger('click')
    await flushPromises()

    const inputs = wrapper.findAll('input.el-input-stub')
    const dialogTextareaProxy = inputs[inputs.length - 1]
    await dialogTextareaProxy.setValue('  malicious usage  ')

    const confirmButton = wrapper
      .findAll('button.el-button-stub')
      .find((button) => button.text().includes('确认'))
    expect(confirmButton).toBeDefined()
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(reviewClientMock).toHaveBeenCalledWith('oauth-client-1', {
      reviewStatus: 'rejected',
      reviewComment: 'malicious usage',
    })
    expect(messageSuccessMock).toHaveBeenCalled()
  })

  it('shows delete action for approved rows and calls delete API', async () => {
    listClientsForReviewMock.mockResolvedValueOnce({
      data: {
        items: [createRow({ reviewStatus: 'approved', reviewComment: 'approved before' })],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })

    const wrapper = mountView()
    await flushPromises()

    const deleteButton = wrapper
      .findAll('button.el-button-stub')
      .find((button) => button.text().includes('删除'))
    expect(deleteButton).toBeDefined()

    await deleteButton!.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalled()
    expect(deleteClientForReviewMock).toHaveBeenCalledWith('oauth-client-1')
    expect(messageSuccessMock).toHaveBeenCalled()
  })
})
