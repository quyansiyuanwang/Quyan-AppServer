import type { Component } from 'vue'

const views = import.meta.glob<Component>('../../views/relay/**/*.vue', {
  eager: true,
  import: 'default',
})

export const getView = (path: string): Component => {
  const view = views[`../../views/relay/${path}`]
  if (!view) throw new Error(`Unknown relay feature view: ${path}`)
  return view
}
