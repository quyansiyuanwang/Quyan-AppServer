import './repair.css'
import { diagnoseBrowser, resetBrowserData, type RepairItem } from '@/service/browserRepairService'
import { repairMessages } from './messages'
import { getRouteCatalogEntry } from '@/router/route-catalog'
import {
  getSiteProfileForEnvironment,
  resolveCurrentSiteProfile,
  isKnownSiteProfile,
} from '@/config/site-registry'

const requestedLocale = new URLSearchParams(location.search).get('locale')
let locale: 'en' | 'zh-CN' =
  requestedLocale === 'en' || (!requestedLocale && navigator.language.startsWith('en'))
    ? 'en'
    : 'zh-CN'
const root = document.getElementById('repair')!
let busy = false
function render(): void {
  const t = repairMessages[locale]
  document.documentElement.lang = locale
  // All interpolated values below are authored copy, never server or browser data.
  root.innerHTML = `<header><span>${t.eyebrow}</span><button id="language" class="text-button">${locale === 'en' ? '中文' : 'English'}</button></header>
    <h1>${t.title}</h1><p class="intro">${t.intro}</p>
    <button id="diagnose" class="primary">${t.diagnose}</button>
    <section class="choices"><article><span class="number">01</span><h2>${t.auth}</h2><p>${t.authHelp}</p><button id="auth">${t.auth}</button></article>
    <article><span class="number">02</span><h2>${t.all}</h2><p>${t.allHelp}</p><button id="all" class="danger">${t.all}</button></article></section>
    <p id="status" role="status" aria-live="polite"></p><ul id="results" aria-label="Results"></ul>
    <aside><h2>${t.helpTitle}</h2><p>${t.help}</p><p>${t.boundary}</p></aside><a id="back">${t.back} →</a>`
  const loginPath = getRouteCatalogEntry('login')!.path
  const current = resolveCurrentSiteProfile()
  const identity = isKnownSiteProfile(current)
    ? getSiteProfileForEnvironment('identity', current)
    : undefined
  ;(document.getElementById('back') as HTMLAnchorElement).href = new URL(
    loginPath,
    identity?.canonicalOrigin ?? location.origin,
  ).toString()
  document.getElementById('language')!.onclick = () => {
    if (!busy) {
      locale = locale === 'en' ? 'zh-CN' : 'en'
      render()
    }
  }
  document.getElementById('diagnose')!.onclick = () => {
    void run('diagnose')
  }
  document.getElementById('auth')!.onclick = () => {
    if (window.confirm(t.confirmAuth)) void run('auth')
  }
  document.getElementById('all')!.onclick = () => {
    if (window.confirm(t.confirmAll) && window.confirm(t.confirmAgain)) void run('all')
  }
}
async function run(action: 'diagnose' | 'auth' | 'all'): Promise<void> {
  if (busy) return
  busy = true
  const t = repairMessages[locale]
  root.querySelectorAll('button').forEach((button) => {
    button.disabled = true
  })
  const status = document.getElementById('status')!
  const list = document.getElementById('results')!
  status.textContent = t.running
  list.replaceChildren()
  try {
    const results: RepairItem[] =
      action === 'diagnose' ? await diagnoseBrowser(locale) : await resetBrowserData(action, locale)
    for (const result of results) {
      const row = document.createElement('li')
      row.dataset.state = result.state
      row.textContent = `${t[result.item as keyof typeof t] ?? result.item} — ${t[result.state]}`
      list.append(row)
    }
    status.textContent =
      action === 'diagnose'
        ? t.checked
        : results.every((result) => result.state === 'ok')
          ? t.done
          : t.partial
  } catch {
    status.textContent = t.partial
  } finally {
    busy = false
    root.querySelectorAll('button').forEach((button) => {
      button.disabled = false
    })
  }
}
render()
