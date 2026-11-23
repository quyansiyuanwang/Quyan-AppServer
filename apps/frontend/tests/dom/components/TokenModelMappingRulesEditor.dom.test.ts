// @vitest-environment jsdom
import { computed, defineComponent, inject, provide, ref } from 'vue'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RelayTokenModelMappingRule } from '@quyan/shared'
import TokenModelMappingRulesEditor from '@/components/relay/TokenModelMappingRulesEditor.vue'
import { getLocale, i18ns, setLocale } from '@/locales'

const { previewMock, candidatesMock, copyMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  candidatesMock: vi.fn(),
  copyMock: vi.fn(async (_value: string) => true),
}))
vi.mock('@/service/relayTokenService', () => ({
  relayTokenService: {
    previewModelMapping: previewMock,
    getModelMappingChannelOptions: candidatesMock,
  },
}))
vi.mock('@/utils/clipboard', () => ({ copyTextWithFallback: copyMock }))
vi.mock('@/utils/elementPlusRuntime', () => ({ ElMessage: { success: vi.fn(), error: vi.fn() } }))

const ElAlert = defineComponent({
  name: 'ElAlert',
  props: ['title'],
  template: '<div role="alert">{{ title }}</div>',
})
const ElButton = defineComponent({
  name: 'ElButton',
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
})
const ElInput = defineComponent({
  name: 'ElInput',
  props: ['modelValue', 'type'],
  emits: ['update:modelValue'],
  template:
    '<textarea v-if="type === \'textarea\'" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><input v-else :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
})
const ElSelect = defineComponent({
  name: 'ElSelect',
  props: ['modelValue', 'remoteMethod'],
  emits: ['update:modelValue', 'visible-change'],
  template:
    '<div><select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select><slot name="footer" /></div>',
})
const ElOption = defineComponent({
  name: 'ElOption',
  props: ['label', 'value'],
  template: '<option :value="value">{{ label }}</option>',
})
const ElPagination = defineComponent({
  name: 'ElPagination',
  props: ['currentPage', 'total', 'pageSize'],
  emits: ['update:currentPage', 'current-change'],
  template: '<div />',
})
const ElTable = defineComponent({
  name: 'ElTable',
  props: ['data'],
  setup(props) {
    provide(
      'mappingPreviewRows',
      computed(() => props.data),
    )
  },
  template: '<div><slot /></div>',
})
const ElTableColumn = defineComponent({
  name: 'ElTableColumn',
  props: ['prop'],
  setup() {
    return { rows: inject('mappingPreviewRows') }
  },
  template:
    '<div><div v-for="(row, index) in rows" :key="index"><slot :row="row">{{ row[prop] }}</slot></div></div>',
})

const initialLocale = getLocale()
enableAutoUnmount(afterEach)
afterEach(async () => {
  vi.useRealTimers()
  await setLocale(initialLocale)
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  candidatesMock.mockResolvedValue({
    items: [{ id: 'channel-a', name: 'Channel A' }],
    total: 41,
    page: 1,
    pageSize: 20,
  })
  previewMock.mockResolvedValue({ items: [], diagnostics: [], total: 41, page: 1, pageSize: 20 })
})
const rule = (source = 'friendly', channelIds?: string[]): RelayTokenModelMappingRule => ({
  source,
  target: 'actual',
  preference: 'mapping-first',
  ...(channelIds ? { channelIds } : {}),
})
function mountEditor(initial: RelayTokenModelMappingRule[] = [rule()]) {
  const rules = ref(initial)
  const draft = ref({
    routingMode: 'composite' as const,
    memberTokenConfigs: [{ tokenId: 'member', enabled: true, priority: 0 }],
    targetUserId: 'owner',
    editingTokenId: 'current',
    failoverConfig: { maxAcceptedChannelMultiplier: null as number | null },
  })
  const wrapper = mount(
    defineComponent({
      components: { TokenModelMappingRulesEditor },
      setup: () => ({ rules, draft }),
      template:
        '<TokenModelMappingRulesEditor v-model="rules" :draft="draft" :available-models="[\'actual\']" />',
    }),
    {
      global: {
        stubs: {
          'el-alert': ElAlert,
          'el-button': ElButton,
          'el-input': ElInput,
          'el-option': ElOption,
          'el-pagination': ElPagination,
          'el-select': ElSelect,
          'el-table': ElTable,
          'el-table-column': ElTableColumn,
        },
      },
    },
  )
  return { wrapper, editor: wrapper.getComponent(TokenModelMappingRulesEditor), rules, draft }
}
async function tick() {
  await vi.advanceTimersByTimeAsync(310)
  await flushPromises()
}
const result = (model: string) => ({
  items: [
    {
      channelId: 'channel-a',
      channelName: model,
      tokenPathIds: ['current', 'member'],
      requestedModel: model,
      outcome: 'mapped',
      reason: 'available',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  diagnostics: [],
})
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('token owned mapping rules', () => {
  it('adds, copies, reorders and deletes independently without changing referenced members', async () => {
    const { wrapper, rules, draft } = mountEditor([rule('one', ['channel-a']), rule('two')])
    const before = JSON.stringify(draft.value.memberTokenConfigs)
    const first = wrapper.findAll('[data-testid="mapping-rule"]')[0]!
    await first
      .findAll('button')
      .find((button) => button.text() === i18ns.t('relay.tokenMappingCopy'))!
      .trigger('click')
    expect(rules.value.map((item) => item.source)).toEqual(['one', 'one', 'two'])
    rules.value[1]!.channelIds!.push('channel-b')
    expect(rules.value[0]!.channelIds).toEqual(['channel-a'])
    await wrapper
      .findAll('[data-testid="mapping-rule"]')[2]!
      .get(`[aria-label="${i18ns.t('relay.compositionMoveUp')}"]`)
      .trigger('click')
    expect(rules.value.map((item) => item.source)).toEqual(['one', 'two', 'one'])
    await wrapper
      .findAll('[data-testid="mapping-rule"]')[0]!
      .findAll('button')
      .find((button) => button.text() === i18ns.t('delete'))!
      .trigger('click')
    await wrapper.get('[data-testid="add-rule"]').trigger('click')
    expect(rules.value.at(-1)).toEqual({ source: '', target: '', preference: 'mapping-first' })
    expect(JSON.stringify(draft.value.memberTokenConfigs)).toBe(before)
  })

  it('edits sources, literal targets, scoped channels and availability preference', async () => {
    const { editor, rules } = mountEditor()
    const inputs = editor.findAllComponents(ElInput)
    await inputs[0]!.get('input').setValue('friendly-*')
    const selects = editor.findAllComponents(ElSelect)
    selects[0]!.vm.$emit('update:modelValue', 'literal-*')
    await flushPromises()
    selects[1]!.vm.$emit('update:modelValue', ['channel-a'])
    await flushPromises()
    selects[2]!.vm.$emit('update:modelValue', 'original-first')
    await flushPromises()
    expect(rules.value).toEqual([
      {
        source: 'friendly-*',
        target: 'literal-*',
        channelIds: ['channel-a'],
        preference: 'original-first',
      },
    ])
  })

  it('uses shared scope-aware diagnostics and refuses malformed JSON imports', async () => {
    const { wrapper, rules } = mountEditor([rule('friendly-*'), rule('friendly-model')])
    expect(wrapper.text()).toContain(i18ns.t('relay.tokenMappingOverlap'))
    expect(wrapper.text()).not.toContain('overlapping-patterns')
    rules.value = [rule('friendly', ['channel-a']), rule('friendly', ['channel-b'])]
    await flushPromises()
    expect(wrapper.text()).not.toContain(i18ns.t('relay.tokenMappingDuplicate'))
    rules.value[1]!.channelIds = ['channel-a']
    await flushPromises()
    expect(wrapper.text()).toContain(i18ns.t('relay.tokenMappingDuplicate'))
    expect(wrapper.text()).not.toContain('duplicate-source')
    await wrapper.get('[data-testid="import-rules"]').trigger('click')
    await wrapper.get('textarea').setValue(JSON.stringify([{ ...rule(), channelIds: 'invalid' }]))
    await wrapper.get('[data-testid="apply-import"]').trigger('click')
    expect(wrapper.text()).toContain(i18ns.t('relay.tokenMappingInvalid'))
    expect(rules.value).toHaveLength(2)
    await wrapper.get('textarea').setValue(JSON.stringify([rule('imported', ['channel-b'])]))
    await wrapper.get('[data-testid="apply-import"]').trigger('click')
    await wrapper.get('[data-testid="export-rules"]').trigger('click')
    expect(JSON.parse(copyMock.mock.calls[0]![0]!)).toEqual([rule('imported', ['channel-b'])])
  })

  it('requests paginated remote scope candidates with selected IDs and invalidates stale searches', async () => {
    const { editor } = mountEditor([rule('friendly', ['channel-a'])])
    await tick()
    expect(candidatesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({ routingMode: 'composite' }),
        selectedIds: ['channel-a'],
        page: 1,
        pageSize: 20,
      }),
    )
    const pagination = editor.findAllComponents(ElPagination)[0]!
    pagination.vm.$emit('update:currentPage', 2)
    pagination.vm.$emit('current-change', 2)
    await flushPromises()
    expect(candidatesMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    const stale = deferred<ReturnType<typeof result>>()
    candidatesMock.mockReturnValueOnce(stale.promise)
    const scope = editor.findAllComponents(ElSelect)[1]!
    scope.props('remoteMethod')!('old')
    await tick()
    scope.props('remoteMethod')!('new')
    stale.resolve({ ...result('old'), items: [] })
    await flushPromises()
    expect(
      editor.findAllComponents(ElOption).some((option) => option.props('label') === 'Channel A'),
    ).toBe(true)
    await tick()
    expect(candidatesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'new', page: 1 }),
    )
  })

  it('debounces previews, sends the draft, invalidates immediately and discards stale results', async () => {
    const { editor, rules, draft } = mountEditor()
    const stale = deferred<ReturnType<typeof result>>()
    previewMock.mockReturnValueOnce(stale.promise)
    const model = editor.findAllComponents(ElSelect).at(-2)!
    model.vm.$emit('update:modelValue', 'first')
    await tick()
    expect(previewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestModel: 'first',
        requestFormat: 'openai-chat-completions',
        draft: expect.objectContaining({
          routingMode: 'composite',
          modelMappingRules: [rule()],
          editingTokenId: 'current',
          targetUserId: 'owner',
        }),
      }),
    )
    expect(previewMock.mock.calls[0]![0]).not.toHaveProperty('routingMode')
    rules.value[0]!.preference = 'original-first'
    stale.resolve(result('old'))
    await flushPromises()
    expect(editor.findComponent(ElTable).exists()).toBe(false)
    previewMock.mockResolvedValueOnce(result('fresh'))
    await tick()
    expect(editor.findComponent(ElTable).props('data')[0].channelName).toBe('fresh')
    draft.value.targetUserId = 'another-owner'
    await flushPromises()
    expect(editor.findComponent(ElTable).exists()).toBe(false)
  })

  it('loads each rule scope independently instead of combining selected channels across rules', async () => {
    const { editor } = mountEditor([rule('first', ['channel-a']), rule('second', ['channel-b'])])
    await tick()
    expect(candidatesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedIds: ['channel-a'] }),
    )
    editor.findAllComponents(ElSelect)[4]!.vm.$emit('visible-change', true)
    await flushPromises()
    expect(candidatesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedIds: ['channel-b'], page: 1 }),
    )
  })

  it('coalesces fast model changes and invalidates results when the request format changes', async () => {
    const { editor } = mountEditor()
    const model = editor.findAllComponents(ElSelect).at(-2)!
    model.vm.$emit('update:modelValue', 'first')
    await flushPromises()
    model.vm.$emit('update:modelValue', 'second')
    await flushPromises()
    model.vm.$emit('update:modelValue', 'final')
    await tick()
    expect(previewMock).toHaveBeenCalledTimes(1)
    expect(previewMock).toHaveBeenLastCalledWith(expect.objectContaining({ requestModel: 'final' }))
    expect(editor.findComponent(ElTable).exists()).toBe(true)
    editor.findAllComponents(ElSelect).at(-1)!.vm.$emit('update:modelValue', 'anthropic')
    await flushPromises()
    expect(editor.findComponent(ElTable).exists()).toBe(false)
    await tick()
    expect(previewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestFormat: 'anthropic', page: 1 }),
    )
  })

  it('paginates previews and ignores pending responses after unmount', async () => {
    const { wrapper, editor } = mountEditor()
    editor.findAllComponents(ElSelect).at(-2)!.vm.$emit('update:modelValue', 'friendly')
    await tick()
    editor.findAllComponents(ElPagination).at(-1)!.vm.$emit('update:currentPage', 2)
    await tick()
    expect(previewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, requestModel: 'friendly' }),
    )
    const pending = deferred<ReturnType<typeof result>>()
    previewMock.mockReturnValueOnce(pending.promise)
    editor.findAllComponents(ElSelect).at(-2)!.vm.$emit('update:modelValue', 'next')
    await tick()
    wrapper.unmount()
    pending.resolve(result('late'))
    await flushPromises()
    expect(previewMock).toHaveBeenCalledTimes(3)
  })

  it('invalidates and rechecks preview and channel candidates when the edited multiplier ceiling changes', async () => {
    const { editor, draft } = mountEditor()
    editor.findAllComponents(ElSelect).at(-2)!.vm.$emit('update:modelValue', 'friendly')
    await tick()
    expect(editor.findComponent(ElTable).exists()).toBe(true)
    draft.value.failoverConfig.maxAcceptedChannelMultiplier = 2.5
    await flushPromises()
    expect(editor.findComponent(ElTable).exists()).toBe(false)
    await tick()
    for (const request of [previewMock, candidatesMock])
      expect(request).toHaveBeenLastCalledWith(
        expect.objectContaining({
          draft: expect.objectContaining({ failoverConfig: { maxAcceptedChannelMultiplier: 2.5 } }),
        }),
      )
    draft.value.failoverConfig.maxAcceptedChannelMultiplier = null
    await tick()
    expect(previewMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({ failoverConfig: { maxAcceptedChannelMultiplier: null } }),
      }),
    )
  })

  it.each(['zh-CN', 'en', 'emoji'] as const)(
    'localizes preview reasons and token references in %s',
    async (locale) => {
      await setLocale(locale)
      const cases = [
        ['mapped', 'relay.tokenMappingMapped'],
        ['original', 'relay.tokenMappingOriginal'],
        ['fallback', 'relay.tokenMappingFallback'],
        ['model-unavailable', 'relay.tokenMappingModelUnavailable'],
        ['mapped-model-unavailable', 'relay.tokenMappingModelUnavailable'],
        ['format-unsupported', 'relay.tokenMappingFormatUnsupported'],
        ['model-not-allowed', 'relay.tokenMappingWhitelistDenied'],
        ['multiplier-exceeded', 'relay.tokenMappingMultiplierExceeded'],
        ['future-internal-reason', 'relay.tokenMappingReasonUnknown'],
      ] as const
      previewMock.mockResolvedValueOnce({
        ...result('friendly'),
        items: cases.map(([reason], index) => ({
          ...result('friendly').items[0],
          reason,
          tokenPathIds: ['__model_mapping_preview__', 'member-without-name'],
          ruleSource:
            index === 0
              ? '__model_mapping_preview__'
              : index === 1
                ? 'current'
                : 'member-without-name',
        })),
        diagnostics: [
          { ruleIndex: 0, otherRuleIndex: 1, severity: 'warning', code: 'overlapping-patterns' },
        ],
      })
      const { editor } = mountEditor()
      editor.findAllComponents(ElSelect).at(-2)!.vm.$emit('update:modelValue', 'friendly')
      await tick()
      expect(editor.findAll('[data-testid="mapping-reason"]').map((item) => item.text())).toEqual(
        cases.map(([, key]) => i18ns.t(key)),
      )
      expect(editor.get('[data-testid="mapping-path"]').text()).toBe(
        `${i18ns.t('relay.tokenMappingCurrentToken')} → member-without-name`,
      )
      const owners = editor.findAll('[data-testid="mapping-rule-owner"]').map((item) => item.text())
      expect(owners.slice(0, 2)).toEqual([
        i18ns.t('relay.tokenMappingCurrentToken'),
        i18ns.t('relay.tokenMappingCurrentToken'),
      ])
      expect(owners[2]).toBe('member-without-name')
      expect(editor.text()).not.toContain('__model_mapping_preview__')
      expect(editor.text()).not.toContain('overlapping-patterns')
      expect(editor.text()).not.toContain('future-internal-reason')
      expect(editor.text()).toContain(`#1 ${i18ns.t('relay.tokenMappingOverlap')} (#2)`)
    },
  )
})
