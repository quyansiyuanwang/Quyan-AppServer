// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { prepareStreamingRequest, refreshStreamingSession } = vi.hoisted(() => ({
  prepareStreamingRequest: vi.fn(),
  refreshStreamingSession: vi.fn(),
}))

vi.mock('@/locales', () => ({
  i18ns: {
    refer: { value: 'zh-CN' },
    t: (key: string) => key,
  },
}))

vi.mock('@/stores/request', () => ({
  useRequestStore: () => ({
    getAxios: vi.fn(),
    prepareStreamingRequest,
    refreshStreamingSession,
  }),
}))

vi.mock('@/router', () => ({
  currentSiteProfile: { id: 'relay' },
  default: { currentRoute: { value: { name: 'relayTokenManagement' } } },
}))

vi.mock('@/client/services/support-controller.gen', () => ({
  createSupportControllerApi: () => ({ handoff: vi.fn() }),
}))

import SupportAssistantPanel from '@/components/support/SupportAssistantPanel.vue'

const stubs = {
  'el-input': {
    props: ['modelValue'],
    emits: ['update:modelValue', 'keydown'],
    template:
      '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" />',
  },
  'el-button': {
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
  },
  'el-alert': { template: '<div><slot /></div>' },
}

describe('SupportAssistantPanel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends JSON content for a signed support stream request', async () => {
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<main class="el-main">Relay Token Management Create token</main>',
    )
    prepareStreamingRequest.mockResolvedValue({
      url: 'https://backend.example.test/v1/support/messages',
      headers: { Authorization: 'Bearer access-token', 'X-Sign': 'signature' },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('data: {"type":"delta","content":"answer"}\n\ndata: [DONE]\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )

    const wrapper = mount(SupportAssistantPanel, { global: { stubs } })
    await wrapper.find('textarea').setValue('Need help')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'confirm')
      ?.trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(fetch).toHaveBeenCalledWith(
      'https://backend.example.test/v1/support/messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json',
        }),
      }),
    )
    const [, request] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toMatchObject({
      page: {
        site: 'relay',
        route: 'relayTokenManagement',
        visibleText: 'Relay Token Management Create token',
      },
    })
    wrapper.unmount()
    document.querySelector('.el-main')?.remove()
  })
})
