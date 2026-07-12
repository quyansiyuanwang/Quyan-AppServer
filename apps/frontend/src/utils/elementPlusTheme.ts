let darkThemeCssPromise: Promise<unknown> | null = null

export function isDarkThemeActive(): boolean {
  const root = document.documentElement
  return root.classList.contains('dark') || root.getAttribute('data-theme') === 'dark'
}

export function ensureElementPlusDarkTheme(): Promise<unknown> {
  if (!darkThemeCssPromise) {
    darkThemeCssPromise = import('element-plus/theme-chalk/dark/css-vars.css')
  }

  return darkThemeCssPromise
}