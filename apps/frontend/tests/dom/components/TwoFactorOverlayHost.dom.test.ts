// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { CustomCode } from '@/constant/custom-code'
import StorageKey from '@/constant/storagekey'
import { twoFactorOverlayService } from '@/service/twoFactorOverlayService'
import { navigateToTwoFactorVerification } from '@/service/twoFactorNavigationService'

vi.mock('@/components/auth/TwoFactorVerificationPanel.vue', () => ({
  default: defineComponent({
    name: 'TwoFactorVerificationPanel',
    template: '<button data-testid="verify-button">Verify</button>',
  }),
}))

vi.mock('@/locales', () => ({ i18ns: { t: (key: string) => key } }))

import TwoFactorOverlayHost from '@/components/auth/TwoFactorOverlayHost.vue'

const mountPage = () =>
  mount(
    defineComponent({
      components: { TwoFactorOverlayHost },
      data: () => ({ draft: 'unsaved changes' }),
      template: '<div><input data-testid="draft" v-model="draft" /><TwoFactorOverlayHost /></div>',
    }),
    { attachTo: document.getElementById('app')! },
  )

describe('2FA full-screen overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>'
    window.history.replaceState(null, '', '/channels/probes?tab=edit')
    window.sessionStorage.clear()
    twoFactorOverlayService.close()
  })

  afterEach(() => {
    twoFactorOverlayService.close()
    document.body.innerHTML = ''
  })

  it('keeps the current route and unsaved input while sharing a single challenge', async () => {
    const wrapper = mountPage()
    await wrapper.get('[data-testid="draft"]').setValue('my draft')
    const pathBefore = window.location.href

    const first = {
      code: CustomCode.TWO_FACTOR_REQUIRED,
      data: { challengeToken: 'first', purpose: 'stepup', method: 'code' },
    }
    const second = {
      code: CustomCode.TWO_FACTOR_REQUIRED,
      data: { challengeToken: 'second', purpose: 'stepup', method: 'code' },
    }
    expect(await navigateToTwoFactorVerification(first)).toBe(true)
    expect(await navigateToTwoFactorVerification(second)).toBe(true)
    await nextTick()

    expect(window.location.href).toBe(pathBefore)
    expect(wrapper.get('[data-testid="draft"]').element).toHaveProperty('value', 'my draft')
    expect(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).toHaveLength(1)
    expect(document.getElementById('app')?.inert).toBe(true)
    expect(twoFactorOverlayService.state.context?.challengeToken).toBe('first')
    expect(
      JSON.parse(sessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE)!),
    ).toMatchObject({ challengeToken: 'first' })

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    document.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(twoFactorOverlayService.state.visible).toBe(true)

    twoFactorOverlayService.close()
    await nextTick()
    expect(document.getElementById('app')?.inert).toBe(false)
    expect(document.body.style.overflow).toBe('')
    wrapper.unmount()
  })

  it('restores a pending challenge after reloading and rejects malformed state', async () => {
    const wrapper = mountPage()
    sessionStorage.setItem(
      StorageKey.Auth.PENDING_TWO_FACTOR_CHALLENGE,
      JSON.stringify({ challengeToken: 'restored' }),
    )
    sessionStorage.setItem(
      StorageKey.Auth.PENDING_TWO_FACTOR_OVERLAY,
      JSON.stringify({
        method: 'email',
        purpose: 'login',
        authEntry: 'register',
        createdAt: Date.now(),
      }),
    )
    expect(twoFactorOverlayService.restore()).toBe(true)
    await nextTick()
    expect(twoFactorOverlayService.state.context).toMatchObject({
      challengeToken: 'restored',
      method: 'email',
      authEntry: 'register',
    })
    twoFactorOverlayService.close()
    sessionStorage.setItem(StorageKey.Auth.PENDING_TWO_FACTOR_OVERLAY, '{invalid')
    expect(twoFactorOverlayService.restore()).toBe(false)
    expect(sessionStorage.getItem(StorageKey.Auth.PENDING_TWO_FACTOR_OVERLAY)).toBeNull()
    wrapper.unmount()
  })
})
