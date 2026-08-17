import type { Component } from 'vue'

const views = import.meta.glob<Component>('../../views/analytics/**/*.vue', {
  eager: true,
  import: 'default',
})

export const getView = (path: string): Component => {
  const view = views[`../../views/analytics/${path}`]
  if (!view) throw new Error(`Unknown analytics feature view: ${path}`)
  return view
}
