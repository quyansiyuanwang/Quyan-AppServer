import type { Component } from 'vue'

const views = import.meta.glob<Component>('../../views/auth/**/*.vue', {
  eager: true,
  import: 'default',
})

export const getView = (path: string): Component => {
  const view = views[`../../views/auth/${path}`]
  if (!view) throw new Error(`Unknown auth feature view: ${path}`)
  return view
}
