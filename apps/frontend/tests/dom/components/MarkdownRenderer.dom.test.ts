// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { copyTextWithFallback } = vi.hoisted(() => ({ copyTextWithFallback: vi.fn() }))

vi.mock('@/locales', () => ({
  i18ns: { t: (key: string) => key },
}))

vi.mock('@/utils/asyncMarkdown', () => ({
  renderArticleMarkdown: vi
    .fn()
    .mockResolvedValue('<pre><code class="language-ts">const answer = 42</code></pre>'),
}))

vi.mock('@/utils/clipboard', () => ({ copyTextWithFallback }))
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn(), success: vi.fn() } }))

import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

describe('MarkdownRenderer', () => {
  it('adds a language label and copies fenced code blocks', async () => {
    copyTextWithFallback.mockResolvedValue(true)
    const wrapper = mount(MarkdownRenderer, { props: { content: '```ts\nconst answer = 42\n```' } })

    await vi.waitFor(() => expect(wrapper.find('.markdown-code-block').exists()).toBe(true))

    expect(wrapper.find('.markdown-code-block__language').text()).toBe('TypeScript')
    await wrapper.find<HTMLButtonElement>('.markdown-code-block__copy').trigger('click')

    expect(copyTextWithFallback).toHaveBeenCalledWith('const answer = 42')
  })
})
