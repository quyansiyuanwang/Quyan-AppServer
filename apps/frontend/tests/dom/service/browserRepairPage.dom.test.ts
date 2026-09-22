// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const repair = vi.hoisted(() => ({ diagnoseBrowser: vi.fn(), resetBrowserData: vi.fn() }))
vi.mock('@/service/browserRepairService', () => repair)

describe('independent repair document', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    document.body.innerHTML = '<main id="repair"></main>'
    window.history.replaceState({}, '', '/repair.html?locale=en')
  })
  it('renders when browser storage is forbidden and does not clear on canceled confirmation', async () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      await import('@/repair/main')
      expect(document.querySelector('h1')?.textContent).toContain('signing in')
      ;(document.getElementById('auth') as HTMLButtonElement).click()
      ;(document.getElementById('all') as HTMLButtonElement).click()
      expect(repair.resetBrowserData).not.toHaveBeenCalled()
      expect(repair.diagnoseBrowser).not.toHaveBeenCalled()
    } finally {
      read.mockRestore()
      confirm.mockRestore()
    }
  })
  it('requires both confirmations and reports partial rather than total success', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false)
    try {
      await import('@/repair/main')
      ;(document.getElementById('all') as HTMLButtonElement).click()
      expect(repair.resetBrowserData).not.toHaveBeenCalled()
      confirm.mockReturnValue(true)
      repair.resetBrowserData.mockResolvedValue([{ item: 'cookieInstructions', state: 'failed' }])
      ;(document.getElementById('all') as HTMLButtonElement).click()
      await vi.waitFor(() =>
        expect(document.getElementById('status')?.textContent).toMatch(
          /incomplete|could not|unconfirmed/i,
        ),
      )
      expect(repair.resetBrowserData).toHaveBeenCalledWith('all', 'en')
    } finally {
      confirm.mockRestore()
    }
  })
})
