import type { Component } from 'vue'

const views = import.meta.glob<Component>('../../views/management/**/*.vue', {
  eager: true,
  import: 'default',
})

export const getView = (path: string): Component => {
  const view = views[`../../views/management/${path}`]
  if (!view) throw new Error(`Unknown management feature view: ${path}`)
  return view
}
