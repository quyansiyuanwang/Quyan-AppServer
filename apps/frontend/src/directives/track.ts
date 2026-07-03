import type { Directive, DirectiveBinding } from 'vue'
import { tracker } from '@/utils/tracker'

interface TrackBinding {
  name: string
  type?: 'click' | 'expose'
  properties?: Record<string, unknown>
}

interface TrackElement extends HTMLElement {
  _trackClickHandler?: () => void
  _trackObserver?: IntersectionObserver
}

export const vTrack: Directive<TrackElement, TrackBinding> = {
  mounted(el: TrackElement, binding: DirectiveBinding<TrackBinding>) {
    if (!binding.value) return
    const { name, type = 'click', properties } = binding.value

    if (type === 'click') {
      el._trackClickHandler = () => tracker.track('click', name, properties)
      el.addEventListener('click', el._trackClickHandler)
    } else if (type === 'expose') {
      let tracked = false
      const observer = new IntersectionObserver(
        (entries) => {
          if (!tracked && entries[0]?.isIntersecting) {
            tracked = true
            tracker.track('expose', name, properties)
            observer.disconnect()
          }
        },
        { threshold: 0.5 },
      )
      observer.observe(el)
      el._trackObserver = observer
    }
  },
  unmounted(el: TrackElement) {
    if (el._trackClickHandler) {
      el.removeEventListener('click', el._trackClickHandler)
      delete el._trackClickHandler
    }
    if (el._trackObserver) {
      el._trackObserver.disconnect()
      delete el._trackObserver
    }
  },
}
