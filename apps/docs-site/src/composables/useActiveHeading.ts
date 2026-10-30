import { nextTick, onScopeDispose, ref, watch, type Ref } from 'vue'

export function useActiveHeading(
  article: Ref<HTMLElement | null>,
  content: Ref<string>,
  offset: Ref<number>,
) {
  const activeId = ref('')
  let frame = 0
  let headings: HTMLElement[] = []
  let revision = 0
  const update = () => {
    frame = 0
    let current = headings[0]
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top > offset.value + 40) break
      current = heading
    }
    activeId.value = current?.id ?? ''
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  watch(
    [article, content],
    async () => {
      const currentRevision = ++revision
      await nextTick()
      if (currentRevision !== revision) return
      headings = Array.from(article.value?.querySelectorAll<HTMLElement>('h2[id], h3[id]') ?? [])
      update()
    },
    { immediate: true, flush: 'post' },
  )
  watch(offset, schedule)
  window.addEventListener('scroll', schedule, { passive: true })
  onScopeDispose(() => {
    revision++
    window.removeEventListener('scroll', schedule)
    cancelAnimationFrame(frame)
  })
  return activeId
}
