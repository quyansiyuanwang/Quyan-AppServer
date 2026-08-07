// @vitest-environment jsdom
import { defineComponent, h, reactive, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import RelayStandaloneChannelDrawer, {
  type StandaloneChannelFormState,
} from '@/views/relay/components/RelayStandaloneChannelDrawer.vue'

vi.mock('@/composables/usePageDevice', () => ({
  usePageDevice: () => ({ isDesktop: ref(true), isMobile: ref(false) }),
}))

const slotStub = (name: string) =>
  defineComponent({
    name,
    inheritAttrs: true,
    setup(_props, { attrs, slots }) {
      return () => h('div', attrs, slots.default?.())
    },
  })

const createForm = (): StandaloneChannelFormState => ({
  name: 'Claude upstream',
  formats: ['openai'],
  urls: { openai: 'https://api.example.com/v1', anthropic: '', gemini: '' },
  keys: { openai: 'key', anthropic: '', gemini: '' },
  hasKeys: { openai: true, anthropic: false, gemini: false },
  multiplier: 1,
  inputTokensIncludeCacheRead: false,
  allowedModels: ['claude-sonnet'],
  restrictModels: true,
  providers: [],
  mappings: [],
  timePeriodMultipliers: [],
  contextLengthMultipliers: [],
})

const mountDrawer = (mode: 'management' | 'provider') =>
  mount(RelayStandaloneChannelDrawer, {
    props: {
      modelValue: true,
      mode,
      form: reactive(createForm()),
      probeLoading: { openai: false, anthropic: false, gemini: false },
      probeResults: { openai: [], anthropic: [], gemini: [] },
      selectedProbeModels: { openai: [], anthropic: [], gemini: [] },
    },
    global: {
      stubs: {
        'el-drawer': slotStub('ElDrawer'),
        'el-alert': slotStub('ElAlert'),
        'el-form': slotStub('ElForm'),
        'el-form-item': slotStub('ElFormItem'),
        'el-divider': slotStub('ElDivider'),
        'el-checkbox-group': slotStub('ElCheckboxGroup'),
        'el-checkbox': slotStub('ElCheckbox'),
        'el-select': slotStub('ElSelect'),
        'el-option': slotStub('ElOption'),
        'el-input': slotStub('ElInput'),
        'el-input-number': slotStub('ElInputNumber'),
        'el-time-picker': slotStub('ElTimePicker'),
        'el-switch': slotStub('ElSwitch'),
        'el-button': slotStub('ElButton'),
        'el-tag': slotStub('ElTag'),
        RelayProviderShareEditor: slotStub('RelayProviderShareEditor'),
      },
    },
  })

describe('RelayStandaloneChannelDrawer', () => {
  it.each(['management', 'provider'] as const)(
    '%s mode renders only standalone-compatible sections',
    (mode) => {
      const wrapper = mountDrawer(mode)

      for (const section of [
        'formats',
        'upstreams',
        'parameters',
        'providers',
        'mapping',
        'time-rules',
        'context-rules',
      ]) {
        expect(wrapper.find(`[data-section="${section}"]`).exists()).toBe(true)
      }
      expect(wrapper.text()).not.toContain('channelType')
      expect(wrapper.find('[data-section="routing"]').exists()).toBe(false)
      expect(wrapper.find('[data-section="visibility"]').exists()).toBe(false)
    },
  )

  it('offers model discovery only to provider mode', () => {
    const provider = mountDrawer('provider')
    const management = mountDrawer('management')

    expect(provider.find('.probe-row').exists()).toBe(true)
    expect(management.find('.probe-row').exists()).toBe(false)
  })
})
