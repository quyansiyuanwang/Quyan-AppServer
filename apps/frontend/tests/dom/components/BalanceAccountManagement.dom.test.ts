// @vitest-environment jsdom
import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BALANCE_OVERDRAFT_RULE, Permission } from '@quyan/shared'

const fixture = vi.hoisted(() => ({
  service: {
    list: vi.fn(),
    defaults: vi.fn(),
    saveDefaults: vi.fn(),
    preview: vi.fn(),
    saveUsers: vi.fn(),
    adjust: vi.fn(),
    previewAdjustment: vi.fn(),
  },
  granted: new Set<string>(),
  error: vi.fn(),
}))
vi.mock('@/service/balanceManagementService', () => ({ balanceManagementService: fixture.service }))
vi.mock('@/service/balanceTransactionService', () => ({
  balanceTransactionService: { recharge: vi.fn(), getAllTransactions: vi.fn() },
}))
vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: () => ({
    hasPermission: (permission: string) => fixture.granted.has(permission),
  }),
}))
vi.mock('@/utils/elementPlusRuntime', () => ({
  ElMessage: { error: fixture.error, success: vi.fn() },
}))
vi.mock('@/components/balance/AlipayOrdersPanel.vue', () => ({
  default: defineComponent({ render: () => h('div') }),
}))
vi.mock('@/components/balance/OverdraftRuleEditor.vue', () => ({
  default: defineComponent({ props: ['modelValue'], render: () => h('div') }),
}))
import BalanceAccountManagement from '@/components/balance/BalanceAccountManagement.vue'

const row = {
  userId: 'fixture-user',
  username: 'Fixture user',
  balance: -2,
  totalRecharged: 100,
  totalUsed: 102,
  updateTime: null,
  rule: { ...DEFAULT_BALANCE_OVERDRAFT_RULE, mode: 'percent' as const, percent: 10 },
  categories: ['relay' as const],
  ruleInherited: true,
  categoriesInherited: true,
  version: 3,
  defaultVersion: 7,
  overdraftLimit: 10,
  usedOverdraft: 2,
  remainingOverdraft: 8,
  calculationError: false,
}
const defaults = { rule: row.rule, categories: row.categories, version: 7 }
const mountPage = async () => {
  const wrapper = mount(BalanceAccountManagement, {
    global: {
      directives: { loading: {} },
      stubs: {
        'el-table': defineComponent({
          setup(_props, { slots, expose }) {
            expose({ clearSelection: vi.fn() })
            return () => h('div', slots.default?.())
          },
        }),
        'el-table-column': defineComponent({ render: () => h('div') }),
        'el-dialog': defineComponent({
          props: ['modelValue'],
          setup(props, { slots }) {
            return () => (props.modelValue ? h('div', [slots.default?.(), slots.footer?.()]) : null)
          },
        }),
        'el-button': defineComponent({
          props: ['disabled'],
          setup(props, { slots }) {
            return () => h('button', { disabled: props.disabled }, slots.default?.())
          },
        }),
      },
    },
  })
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  vi.resetAllMocks()
  fixture.granted.clear()
  fixture.granted.add(Permission.BALANCE_MANAGEMENT_READ)
  fixture.granted.add(Permission.BALANCE_ACCOUNT_ADJUST)
  fixture.granted.add(Permission.BALANCE_OVERDRAFT_MANAGE)
  fixture.service.list.mockResolvedValue({ records: [row], total: 42, page: 1, pageSize: 20 })
  fixture.service.defaults.mockResolvedValue(structuredClone(defaults))
  fixture.service.preview.mockResolvedValue([row])
  fixture.service.previewAdjustment.mockResolvedValue({
    before: row,
    after: { ...row, totalRecharged: 200, overdraftLimit: 20, remainingOverdraft: 18 },
  })
})
describe('balance account management', () => {
  it('uses server pagination and retains the exact user search filter', async () => {
    const wrapper = await mountPage()
    expect(fixture.service.list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      userId: undefined,
    })
    wrapper.vm.filter = ' fixture-user '
    wrapper.vm.page = 3
    await wrapper.vm.load()
    expect(fixture.service.list).toHaveBeenLastCalledWith({
      page: 3,
      pageSize: 20,
      userId: 'fixture-user',
    })
    expect(wrapper.vm.total).toBe(42)
    wrapper.unmount()
  })
  it('deduplicates pasted IDs and selection and supports independent category reset', async () => {
    const wrapper = await mountPage()
    wrapper.vm.selectionChanged([row])
    wrapper.vm.openBatch()
    wrapper.vm.pastedIds = 'fixture-user, second-user\nsecond-user'
    wrapper.vm.ruleAction = 'keep'
    wrapper.vm.categoryAction = 'inherit'
    await wrapper.vm.preview()
    expect(fixture.service.preview).toHaveBeenCalledWith({
      userIds: ['fixture-user', 'second-user'],
      categories: null,
    })
    await wrapper.vm.saveBatch()
    expect(fixture.service.saveUsers).toHaveBeenCalledWith({
      targets: [{ userId: 'fixture-user', version: 3 }],
      defaultVersion: 7,
      categories: null,
    })
    wrapper.unmount()
  })
  it('discards a trial response when the batch changes during the request', async () => {
    const wrapper = await mountPage()
    let resolve!: (rows: (typeof row)[]) => void
    fixture.service.preview.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    wrapper.vm.openBatch(row)
    const pending = wrapper.vm.preview()
    wrapper.vm.batchRule = { ...row.rule, percent: 20 }
    await nextTick()
    resolve([row])
    await pending
    expect(wrapper.vm.previewRows).toEqual([])
    await wrapper.vm.saveBatch()
    expect(fixture.service.saveUsers).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('requires a new trial after any account correction input changes', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openAdjustment(row)
    wrapper.vm.reason = 'Fix recorded recharge'
    wrapper.vm.adjustments.totalRecharged = { enabled: true, mode: 'set', value: 200 }
    await wrapper.vm.previewAdjustment()
    expect(fixture.service.previewAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ totalRecharged: { mode: 'set', value: 200, expected: 100 } }),
    )
    expect(wrapper.vm.adjustmentPreview.after.overdraftLimit).toBe(20)
    wrapper.vm.adjustments.totalRecharged.value = 300
    await nextTick()
    await wrapper.vm.saveAdjustment()
    expect(fixture.service.adjust).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('corrects only selected statistics and reuses the operation ID for an unchanged retry', async () => {
    const wrapper = await mountPage()
    wrapper.vm.openAdjustment(row)
    wrapper.vm.reason = 'Fix recorded recharge'
    wrapper.vm.adjustments.totalRecharged = { enabled: true, mode: 'set', value: 200 }
    await wrapper.vm.previewAdjustment()
    fixture.service.adjust.mockRejectedValueOnce(new Error('Fixture timeout'))
    await wrapper.vm.saveAdjustment()
    await wrapper.vm.saveAdjustment()
    const [first, retry] = fixture.service.adjust.mock.calls.map((call) => call[0])
    expect(first).toEqual(retry)
    expect(first).toMatchObject({
      userId: row.userId,
      reason: 'Fix recorded recharge',
      totalRecharged: { mode: 'set', value: 200, expected: 100 },
    })
    expect(first).not.toHaveProperty('balance')
    expect(first).not.toHaveProperty('totalUsed')
    wrapper.unmount()
  })
  it('hides policy and correction controls from readers', async () => {
    fixture.granted.delete(Permission.BALANCE_ACCOUNT_ADJUST)
    fixture.granted.delete(Permission.BALANCE_OVERDRAFT_MANAGE)
    const wrapper = await mountPage()
    expect(wrapper.vm.canAdjust).toBe(false)
    expect(wrapper.vm.canOverdraft).toBe(false)
    expect(fixture.service.preview).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
