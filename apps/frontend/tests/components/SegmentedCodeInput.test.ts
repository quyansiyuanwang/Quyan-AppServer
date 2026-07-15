import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SegmentedCodeInput from '@/components/auth/SegmentedCodeInput.vue'

const triggerPaste = async (wrapper: ReturnType<typeof mount>, text: string) => {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: () => text,
    },
  })

  wrapper.find('.segmented-input').element.dispatchEvent(event)
  await wrapper.vm.$nextTick()
}

describe('SegmentedCodeInput', () => {
  it('normalizes numeric paste and caps to configured length', async () => {
    const wrapper = mount(SegmentedCodeInput, {
      props: {
        modelValue: '',
        length: 6,
      },
    })

    await triggerPaste(wrapper, '12ab34!5678')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['123456'])
  })

  it('normalizes alphanumeric paste, converts to uppercase, and keeps separator format', async () => {
    const wrapper = mount(SegmentedCodeInput, {
      props: {
        modelValue: '',
        length: 8,
        allowAlphanumeric: true,
        uppercase: true,
        separatorIndex: 4,
      },
    })

    await triggerPaste(wrapper, 'ab12-3cd4zz99')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['AB12-3CD4'])
  })

  it('passes aria-describedby to each cell input', () => {
    const wrapper = mount(SegmentedCodeInput, {
      props: {
        modelValue: '',
        length: 6,
        ariaDescribedby: 'challenge-description',
      },
    })

    const inputs = wrapper.findAll('input.seg-cell')
    expect(inputs.length).toBe(6)
    for (const input of inputs) {
      expect(input.attributes('aria-describedby')).toBe('challenge-description')
    }
  })

  it('focuses the first input when autofocus is enabled', async () => {
    const wrapper = mount(SegmentedCodeInput, {
      attachTo: document.body,
      props: {
        modelValue: '',
        length: 6,
        autofocus: true,
      },
    })

    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const firstInput = wrapper.find('input.seg-cell').element as HTMLInputElement
    expect(document.activeElement).toBe(firstInput)

    wrapper.unmount()
  })
})
