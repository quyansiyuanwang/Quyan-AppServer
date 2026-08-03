// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/locales', () => ({
  i18ns: {
    t: (key: string) => key,
  },
}))

import ArticleTOC from '@/components/common/ArticleTOC.vue'

describe('ArticleTOC', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('renders headings from markdown content with generated anchor ids', () => {
    const content = '# Intro\n## Install Guide\n### API 参考'

    const wrapper = mount(ArticleTOC, {
      props: {
        content,
      },
    })

    const links = wrapper.findAll('a')
    expect(links).toHaveLength(3)
    expect(links[0]?.attributes('href')).toBe('#intro')
    expect(links[1]?.attributes('href')).toBe('#install-guide')
    expect(links[2]?.attributes('href')).toBe('#api-参考')

    expect(wrapper.findAll('.toc-item')[1]?.attributes('style')).toContain('padding-left: 14px')
  })

  it('renders nothing when content is empty', () => {
    const wrapper = mount(ArticleTOC, {
      props: {
        content: '',
      },
    })

    expect(wrapper.find('.article-toc').exists()).toBe(false)
  })

  it('falls back minLevel to 1 when markdown has no headings', () => {
    const wrapper = mount(ArticleTOC, {
      props: {
        content: 'plain text without heading markers',
      },
    })

    expect((wrapper.vm as any).minLevel).toBe(1)
  })

  it('emits navigate and scrolls to heading on click', async () => {
    const content = '# Intro\n## Install Guide'
    const target = document.createElement('div')
    target.id = 'install-guide'
    const scrollSpy = vi.fn()
    target.scrollIntoView = scrollSpy
    document.body.appendChild(target)

    const wrapper = mount(ArticleTOC, {
      props: {
        content,
      },
    })

    await wrapper.find('a[href="#install-guide"]').trigger('click')

    expect(wrapper.emitted('navigate')?.[0]).toEqual(['install-guide'])
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('emits navigate even when target heading element is not found', async () => {
    const wrapper = mount(ArticleTOC, {
      props: {
        content: '# Intro',
      },
    })

    await wrapper.find('a[href="#intro"]').trigger('click')

    expect(wrapper.emitted('navigate')?.[0]).toEqual(['intro'])
  })
})
