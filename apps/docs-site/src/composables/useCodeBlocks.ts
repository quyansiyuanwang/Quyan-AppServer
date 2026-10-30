import { nextTick, onScopeDispose, watch, type Ref } from 'vue'
import type { DocsLocale } from '@/docs'
import '@/styles/code-blocks.css'

const COPY_FEEDBACK_DURATION_MS = 2000

export function useCodeBlocks(
  article: Ref<HTMLElement | null>,
  content: Ref<string>,
  locale: Ref<DocsLocale>,
) {
  let revision = 0
  let events: AbortController | undefined
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const cleanup = () => {
    revision++
    events?.abort()
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
  }

  watch(
    [content, locale, article],
    async () => {
      cleanup()
      const currentRevision = revision
      await nextTick()
      const root = article.value
      if (!root || currentRevision !== revision) return
      events = new AbortController()
      const signal = events.signal
      // Locale changes can leave identical Markdown HTML in place. Rebuild its controls too.
      for (const wrapper of root.querySelectorAll('.docs-code-block')) {
        const pre = wrapper.querySelector('pre')
        if (pre) wrapper.replaceWith(pre)
      }
      const english = locale.value === 'en'
      const labels = {
        copy: english ? 'Copy' : '复制',
        copied: english ? 'Copied' : '已复制',
        failed: english
          ? 'Copy failed. Select the code to copy.'
          : '复制失败，请选中代码手动复制。',
        wrap: english ? 'Wrap lines' : '自动换行',
        code: english ? 'Code example' : '代码示例',
      }
      const blocks: { code: HTMLElement; source: string; language: string }[] = []
      for (const code of root.querySelectorAll<HTMLElement>('pre > code')) {
        if (code.classList.contains('language-mermaid') || code.closest('.docs-code-block'))
          continue
        const pre = code.parentElement!
        const source = code.textContent ?? ''
        const language =
          [...code.classList].find((name) => name.startsWith('language-'))?.slice(9) ?? 'text'
        const wrapper = document.createElement('div')
        wrapper.className = 'docs-code-block'
        const toolbar = document.createElement('div')
        toolbar.className = 'docs-code-toolbar'
        const name = document.createElement('span')
        name.className = 'docs-code-language'
        name.textContent = language
        const actions = document.createElement('div')
        actions.className = 'docs-code-actions'
        const wrap = document.createElement('button')
        wrap.type = 'button'
        wrap.textContent = labels.wrap
        wrap.setAttribute('aria-pressed', 'false')
        wrap.addEventListener(
          'click',
          () => {
            const enabled = wrapper.classList.toggle('is-wrapped')
            wrap.setAttribute('aria-pressed', String(enabled))
          },
          { signal },
        )
        const copy = document.createElement('button')
        copy.type = 'button'
        copy.textContent = labels.copy
        const status = document.createElement('span')
        status.className = 'docs-code-status'
        status.setAttribute('role', 'status')
        let feedbackTimer: ReturnType<typeof setTimeout> | undefined
        let copySequence = 0
        copy.addEventListener(
          'click',
          async () => {
            const sequence = ++copySequence
            if (feedbackTimer !== undefined) {
              clearTimeout(feedbackTimer)
              timers.delete(feedbackTimer)
            }
            copy.textContent = labels.copy
            status.textContent = ''
            try {
              await navigator.clipboard.writeText(source)
              if (signal.aborted || sequence !== copySequence) return
              copy.textContent = labels.copied
              status.textContent = labels.copied
            } catch {
              if (signal.aborted || sequence !== copySequence) return
              status.textContent = labels.failed
              return
            }
            const timer = setTimeout(() => {
              copy.textContent = labels.copy
              status.textContent = ''
              timers.delete(timer)
            }, COPY_FEEDBACK_DURATION_MS)
            feedbackTimer = timer
            timers.add(timer)
          },
          { signal },
        )
        actions.append(wrap, copy)
        toolbar.append(name, actions)
        pre.before(wrapper)
        wrapper.append(toolbar, pre, status)
        pre.tabIndex = 0
        pre.setAttribute('role', 'region')
        pre.setAttribute('aria-label', `${labels.code}: ${language}`)
        blocks.push({ code, source, language })
      }
      if (!blocks.length) return
      try {
        const { highlightCode } = await import('@/utils/code-highlighter')
        if (currentRevision !== revision) return
        for (const { code, source, language } of blocks) {
          if (!code.isConnected) continue
          const html = highlightCode(source, language)
          if (html !== undefined) code.innerHTML = html
        }
      } catch {
        // Plain code and toolbar remain usable when the optional highlighting chunk cannot load.
      }
    },
    { immediate: true, flush: 'post' },
  )

  onScopeDispose(cleanup)
}
