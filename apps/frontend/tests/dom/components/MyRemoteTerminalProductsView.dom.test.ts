// @vitest-environment jsdom
import { computed, defineComponent, inject, provide, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MANAGED_STATUS } from '@/constant/status'
import MyRemoteTerminalProductsView from '@/views/products/remote-terminal-cloud/MyRemoteTerminalProductsView.vue'

const {
  listPublishedTemplatesMock,
  listMyEntitlementsMock,
  listMyDevicesMock,
  listSessionsMock,
  getMyBalanceMock,
  claimTemplateMock,
  rotateMyRegistrationTokenMock,
  revokeMyDeviceMock,
  getMyDeviceUnbindReminderMock,
  permissionEnsureLoadedMock,
  copyToClipboardMock,
  confirmMock,
  messageSuccessMock,
  messageErrorMock,
  messageWarningMock,
  routerPushMock,
} = vi.hoisted(() => ({
  listPublishedTemplatesMock: vi.fn(),
  listMyEntitlementsMock: vi.fn(),
  listMyDevicesMock: vi.fn(),
  listSessionsMock: vi.fn(),
  getMyBalanceMock: vi.fn(),
  claimTemplateMock: vi.fn(),
  rotateMyRegistrationTokenMock: vi.fn(),
  revokeMyDeviceMock: vi.fn(),
  getMyDeviceUnbindReminderMock: vi.fn(),
  permissionEnsureLoadedMock: vi.fn(),
  copyToClipboardMock: vi.fn(),
  confirmMock: vi.fn(),
  messageSuccessMock: vi.fn(),
  messageErrorMock: vi.fn(),
  messageWarningMock: vi.fn(),
  routerPushMock: vi.fn(),
}))

vi.mock('@/service/remoteTerminalProductService', () => ({
  remoteTerminalProductService: {
    listPublishedTemplates: listPublishedTemplatesMock,
    listMyEntitlements: listMyEntitlementsMock,
    listMyDevices: listMyDevicesMock,
    claimTemplate: claimTemplateMock,
    rotateMyRegistrationToken: rotateMyRegistrationTokenMock,
    revokeMyDevice: revokeMyDeviceMock,
    getMyDeviceUnbindReminder: getMyDeviceUnbindReminderMock,
  },
}))

vi.mock('@/service/remoteTerminalService', () => ({
  remoteTerminalService: {
    listSessions: listSessionsMock,
  },
}))

vi.mock('@/service/permissionService', () => ({
  permissionService: {
    ensureLoaded: permissionEnsureLoadedMock,
  },
}))

vi.mock('@/service/balanceService', () => ({
  balanceService: {
    getMyBalance: getMyBalanceMock,
  },
}))

vi.mock('@/utils/common', async () => {
  const actual = await vi.importActual<any>('@/utils/common')
  return {
    ...actual,
    copyToClipboard: copyToClipboardMock,
  }
})

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    success: messageSuccessMock,
    error: messageErrorMock,
    warning: messageWarningMock,
  },
  ElMessageBox: {
    confirm: confirmMock,
  },
}))

vi.mock('@/locales', () => ({
  i18ns: {
    t: (key: string, params?: Record<string, any>) => {
      if (key === 'remoteTerminalProduct.purchaseLimitValue') {
        return `${params?.count} / ${params?.days}`
      }
      return key
    },
  },
}))

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({
    untilReady: vi.fn(),
  }),
}))

const ElCardStub = defineComponent({ name: 'ElCard', template: '<div class="el-card-stub"><slot name="header" /><slot /></div>' })
const ElEmptyStub = defineComponent({ name: 'ElEmpty', props: { description: { type: String, default: '' } }, template: '<div class="el-empty-stub">{{ description }}</div>' })
const ElAlertStub = defineComponent({ name: 'ElAlert', props: { title: { type: String, default: '' }, description: { type: String, default: '' } }, template: '<div class="el-alert-stub"><slot />{{ title }} {{ description }}</div>' })
const ElTagStub = defineComponent({ name: 'ElTag', template: '<span class="el-tag-stub"><slot /></span>' })
const ElButtonStub = defineComponent({
  name: 'ElButton',
  props: {
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
  },
  emits: ['click'],
  methods: {
    handleClick() {
      if (this.disabled || this.loading) return
      this.$emit('click')
    },
  },
  template:
    '<button class="el-button-stub" :disabled="disabled || loading" @click="handleClick"><slot /></button>',
})
const ElTooltipStub = defineComponent({
  name: 'ElTooltip',
  props: {
    content: { type: String, default: '' },
  },
  template:
    '<div class="el-tooltip-stub"><slot /><slot name="content" /><span class="el-tooltip-content-stub">{{ content }}</span></div>',
})
const ElInputNumberStub = defineComponent({
  name: 'ElInputNumber',
  props: {
    modelValue: { type: Number, default: 0 },
    min: { type: Number, default: undefined },
    step: { type: Number, default: undefined },
    size: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'change'],
  methods: {
    onInput(event: Event) {
      const value = Number((event.target as HTMLInputElement)?.value || 0)
      this.$emit('update:modelValue', value)
      this.$emit('change', value)
    },
  },
  template: '<input class="el-input-number-stub" :value="modelValue" :min="min" @input="onInput" />',
})
const ElTableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, default: () => [] } },
  setup(props) {
    provide('tableRows', computed(() => props.data as any[]))
    return {}
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
const ElTabsStub = defineComponent({ name: 'ElTabs', template: '<div class="el-tabs-stub"><slot /></div>' })
const ElTabPaneStub = defineComponent({ name: 'ElTabPane', template: '<div class="el-tab-pane-stub"><slot /></div>' })
const ElRowStub = defineComponent({ name: 'ElRow', template: '<div class="el-row-stub"><slot /></div>' })
const ElColStub = defineComponent({ name: 'ElCol', template: '<div class="el-col-stub"><slot /></div>' })
const ElIconStub = defineComponent({ name: 'ElIcon', template: '<i><slot /></i>' })
const ElFormStub = defineComponent({ name: 'ElForm', template: '<form><slot /></form>' })
const ElFormItemStub = defineComponent({ name: 'ElFormItem', template: '<div><slot /></div>' })
const ElDialogStub = defineComponent({
  name: 'ElDialog',
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue'],
  template: '<div class="el-dialog-stub" v-if="modelValue"><slot /><slot name="footer" /></div>',
})
const ElCheckboxStub = defineComponent({
  name: 'ElCheckbox',
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue', 'change'],
  methods: {
    toggle() {
      const newVal = !this.modelValue
      this.$emit('update:modelValue', newVal)
      this.$emit('change', newVal)
    },
  },
  template: '<label class="el-checkbox-stub" :data-checked="modelValue" @click.prevent="toggle"><slot /></label>',
})
const ElRadioGroupStub = defineComponent({
  name: 'ElRadioGroup',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    provide('radioGroupModel', computed(() => props.modelValue))
    provide('radioGroupSelect', (value: string) => {
      emit('update:modelValue', value)
      emit('change', value)
    })
    return {}
  },
  template: '<div class="el-radio-group-stub"><slot /></div>',
})
const ElRadioButtonStub = defineComponent({
  name: 'ElRadioButton',
  props: { value: { type: String, default: '' } },
  setup() {
    const model = inject<any>('radioGroupModel', ref(''))
    const select = inject<(value: string) => void>('radioGroupSelect', () => undefined)
    return { model, select }
  },
  template:
    '<button class="el-radio-button-stub" :data-selected="model === value" @click="select(value)"><slot /></button>',
})
const ElSelectStub = defineComponent({
  name: 'ElSelect',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'change'],
  methods: {
    onChange(event: Event) {
      const value = (event.target as HTMLSelectElement)?.value || ''
      this.$emit('update:modelValue', value)
      this.$emit('change', value)
    },
  },
  template: '<select class="el-select-stub" :value="modelValue" @change="onChange"><slot /></select>',
})
const ElOptionStub = defineComponent({
  name: 'ElOption',
  props: { label: { type: String, default: '' }, value: { type: String, default: '' } },
  template: '<option class="el-option-stub" :value="value">{{ label }}</option>',
})

const mountView = () =>
  mount(MyRemoteTerminalProductsView, {
    global: {
      directives: { loading: {} },
      stubs: {
        'el-card': ElCardStub,
        'el-empty': ElEmptyStub,
        'el-alert': ElAlertStub,
        'el-tag': ElTagStub,
        'el-button': ElButtonStub,
        'el-tooltip': ElTooltipStub,
        'el-input-number': ElInputNumberStub,
        'el-table': ElTableStub,
        'el-table-column': ElTableColumnStub,
        'el-tabs': ElTabsStub,
        'el-tab-pane': ElTabPaneStub,
        'el-row': ElRowStub,
        'el-col': ElColStub,
        'el-icon': ElIconStub,
        'el-form': ElFormStub,
        'el-form-item': ElFormItemStub,
        'el-radio-group': ElRadioGroupStub,
        'el-radio-button': ElRadioButtonStub,
        'el-select': ElSelectStub,
        'el-option': ElOptionStub,
        'el-dialog': ElDialogStub,
        'el-checkbox': ElCheckboxStub,
      },
    },
  })

const publishedTemplate = {
  id: 'tpl-1',
  name: 'Starter',
  description: 'plan',
  publishStatus: 'published',
  billingUnit: 'day',
  minimumPurchaseUnits: 1,
  devicePrice: 2,
  terminalPrice: 3,
  deviceDailyPrice: 2,
  terminalDailyPrice: 3,
  currency: '曲',
  purchaseLimitPerUser: 1,
  purchaseLimitWindowDays: 30,
} as any

const entitlementWithToken = {
  id: 'ent-1',
  name: 'Starter',
  templateId: 'tpl-1',
  templateName: 'Starter',
  createTime: '2026-06-01T00:00:00.000Z',
  startAt: '2026-06-01T00:00:00.000Z',
  endAt: '2026-06-30T00:00:00.000Z',
  billingUnit: 'day',
  purchaseUnits: 7,
  durationDays: 7,
  purchasedDeviceCount: 1,
  purchasedTerminalCount: 1,
  purchaseAmount: 35,
  currency: '曲',
  registeredDeviceCount: 0,
  deviceLimit: 2,
  terminalLimit: 1,
  registrationToken: {
    token: 'rtm_current_token',
    maskedToken: 'rtm_...token',
  },
  status: MANAGED_STATUS.ENABLED,
} as any

const deviceRow = {
  id: 'dev-1',
  hostname: 'host-1',
  deviceId: 'device-1',
  entitlementName: 'Starter',
  platform: 'linux',
  lastSeenAt: '2026-06-02T00:00:00.000Z',
} as any

describe('MyRemoteTerminalProductsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listPublishedTemplatesMock.mockResolvedValue([publishedTemplate])
    listMyEntitlementsMock.mockResolvedValue({ records: [entitlementWithToken] })
    listMyDevicesMock.mockResolvedValue({ records: [deviceRow] })
    listSessionsMock.mockResolvedValue([{ id: 'sess-1', status: 'open' }])
    getMyBalanceMock.mockResolvedValue({ balance: 100 })
    claimTemplateMock.mockResolvedValue({ id: 'ent-new' })
    rotateMyRegistrationTokenMock.mockResolvedValue({ token: 'rtm_rotated_token' })
    revokeMyDeviceMock.mockResolvedValue(undefined)
    getMyDeviceUnbindReminderMock.mockResolvedValue({
      maxCount: 3,
      windowHours: 24,
      rebindCooldownMinutes: 5,
      revokedCount: 0,
      remainingCount: 3,
      windowStartAt: new Date().toISOString(),
    })
    permissionEnsureLoadedMock.mockResolvedValue(undefined)
    confirmMock.mockResolvedValue(undefined)
  })

  it('loads and renders product summary', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(permissionEnsureLoadedMock).toHaveBeenCalledTimes(1)
    expect(listPublishedTemplatesMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('remoteTerminalProduct.pageTitle')
    expect(wrapper.text()).toContain('1')
  })

  it('claims a plan and resets the form', async () => {
    listMyEntitlementsMock.mockResolvedValue({ records: [] })
    confirmMock.mockResolvedValue(undefined)
    const wrapper = mountView()
    await flushPromises()

    const inputs = wrapper.findAll('input.el-input-number-stub')
    await inputs[0].setValue('3')
    await inputs[1].setValue('1')
    await inputs[2].setValue('0')

    const buttons = wrapper.findAll('button.el-button-stub')
    const claimButton = buttons.find((button) => button.text().includes('remoteTerminalProduct.claimPlan'))
    expect(claimButton).toBeTruthy()
    await claimButton!.trigger('click')
    await flushPromises()

    expect(claimTemplateMock).toHaveBeenCalledWith({
      templateId: 'tpl-1',
      name: undefined,
      purchaseUnits: 3,
      deviceCount: 1,
      terminalCount: 0,
      targetEntitlementId: undefined,
    })
    expect(messageSuccessMock).toHaveBeenCalledWith('remoteTerminalProduct.claimSuccess')
  })

  it('blocks claims below minimum purchase units with a dedicated message', async () => {
    listPublishedTemplatesMock.mockResolvedValue([
      {
        ...publishedTemplate,
        minimumPurchaseUnits: 2,
      },
    ])
    listMyEntitlementsMock.mockResolvedValue({ records: [] })

    const wrapper = mountView()
    await flushPromises()

    const inputs = wrapper.findAll('input.el-input-number-stub')
    await inputs[0].setValue('1')
    await flushPromises()

    const buttons = wrapper.findAll('button.el-button-stub')
    const claimButton = buttons.find((button) => button.text().includes('remoteTerminalProduct.claimPlan'))
    expect(claimButton).toBeTruthy()
    expect(claimButton!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('remoteTerminalProduct.minimumPurchaseUnitsRequired')
    expect(claimTemplateMock).not.toHaveBeenCalled()
  })

  it('re-normalizes merge quotas when changing target entitlement and sends merged payload', async () => {
    listMyEntitlementsMock.mockResolvedValue({
      records: [
        {
          ...entitlementWithToken,
          id: 'ent-1',
          endAt: '2099-06-20T00:00:00.000Z',
          deviceLimit: 2,
          terminalLimit: 1,
        },
        {
          ...entitlementWithToken,
          id: 'ent-2',
          endAt: '2099-06-10T00:00:00.000Z',
          deviceLimit: 4,
          terminalLimit: 2,
        },
      ],
    })

    const wrapper = mountView()
    await flushPromises()

    const mergeButton = wrapper
      .findAll('button.el-radio-button-stub')
      .find((button) => button.text().includes('remoteTerminalProduct.purchaseModeMerge'))
    expect(mergeButton).toBeTruthy()
    await mergeButton!.trigger('click')
    await flushPromises()

    const select = wrapper.find('select.el-select-stub')
    expect(select.exists()).toBe(true)
    await select.setValue('ent-2')
    await flushPromises()

    const inputs = wrapper.findAll('input.el-input-number-stub')
    await inputs[0].setValue('1')
    await flushPromises()

    const buttons = wrapper.findAll('button.el-button-stub')
    const claimButton = buttons.find((button) => button.text().includes('remoteTerminalProduct.claimPlan'))
    expect(claimButton).toBeTruthy()
    await claimButton!.trigger('click')
    await flushPromises()

    expect(claimTemplateMock).toHaveBeenCalledWith({
      templateId: 'tpl-1',
      name: undefined,
      purchaseUnits: 1,
      deviceCount: 4,
      terminalCount: 2,
      targetEntitlementId: 'ent-2',
    })
  })

  it('shows merge pricing for weekly billing with renewal plus upgrade delta', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-06-01T00:00:00.000Z'))

    listPublishedTemplatesMock.mockResolvedValue([
      {
        ...publishedTemplate,
        billingUnit: 'week',
        devicePrice: 10,
        terminalPrice: 14,
        deviceDailyPrice: Number((10 / 7).toFixed(4)),
        terminalDailyPrice: 2,
      },
    ])
    listMyEntitlementsMock.mockResolvedValue({
      records: [
        {
          ...entitlementWithToken,
          id: 'ent-week',
          startAt: '2099-06-01T00:00:00.000Z',
          endAt: '2099-06-15T00:00:00.000Z',
          billingUnit: 'week',
          purchaseUnits: 2,
          durationDays: 14,
          deviceLimit: 1,
          terminalLimit: 1,
        },
      ],
    })

    const wrapper = mountView()
    await flushPromises()

    const mergeButton = wrapper
      .findAll('button.el-radio-button-stub')
      .find((button) => button.text().includes('remoteTerminalProduct.purchaseModeMerge'))
    expect(mergeButton).toBeTruthy()
    await mergeButton!.trigger('click')
    await flushPromises()

    const inputs = wrapper.findAll('input.el-input-number-stub')
    await inputs[0].setValue('1')
    await inputs[1].setValue('2')
    await flushPromises()

    expect(wrapper.text()).toContain('54 曲')
    vi.useRealTimers()
  })

  it('rotates token after confirmation and copies it', async () => {
    const wrapper = mountView()
    await flushPromises()

    const buttons = wrapper.findAll('button.el-button-stub')
    const rotateButton = buttons.find((button) => button.text().includes('remoteTerminalProduct.rotateToken'))
    expect(rotateButton).toBeTruthy()
    await rotateButton!.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(rotateMyRegistrationTokenMock).toHaveBeenCalledWith('ent-1', {})
    expect(copyToClipboardMock).toHaveBeenCalledWith('rtm_rotated_token', false)
    expect(messageSuccessMock).toHaveBeenCalledWith('remoteTerminalProduct.rotateTokenSuccessAndCopied')
  })

  it('revokes device through custom unbind dialog', async () => {
    const wrapper = mountView()
    await flushPromises()

    const buttons = wrapper.findAll('button.el-button-stub')
    const revokeButton = buttons.find((button) => button.text().includes('remoteTerminalProduct.revokeDevice'))
    expect(revokeButton).toBeTruthy()
    await revokeButton!.trigger('click')
    await flushPromises()

    expect(getMyDeviceUnbindReminderMock).toHaveBeenCalledWith('dev-1')

    const confirmButton = wrapper.findAll('button.el-button-stub').find((button) =>
      button.text().includes('remoteTerminalProduct.revokeDeviceConfirmAction'),
    )
    expect(confirmButton).toBeTruthy()
    expect(confirmButton!.attributes('disabled')).toBeDefined()

    const checkbox = wrapper.find('label.el-checkbox-stub')
    expect(checkbox.exists()).toBe(true)
    await checkbox.trigger('click')
    await flushPromises()

    expect(confirmButton!.attributes('disabled')).toBeUndefined()
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(revokeMyDeviceMock).toHaveBeenCalledWith('dev-1')
    expect(messageSuccessMock).toHaveBeenCalledWith('deleteSuccess')
  })

  it('navigates to console from connection action', async () => {
    const wrapper = mountView()
    await flushPromises()

    const buttons = wrapper.findAll('button.el-button-stub')
    const connectButton = buttons.find((button) => button.text().includes('remoteTerminalProduct.connectDevice'))
    expect(connectButton).toBeTruthy()
    await connectButton!.trigger('click')

    expect(routerPushMock).toHaveBeenCalledWith({ name: 'remoteTerminal' })
  })
})
