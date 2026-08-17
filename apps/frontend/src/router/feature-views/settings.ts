import type { Component } from 'vue'

const views = import.meta.glob<Component>('../../views/settings/**/*.vue', {
  eager: true,
  import: 'default',
})

export const getView = (path: string): Component => {
  const view = views[`../../views/settings/${path}`]
  if (!view) throw new Error(`Unknown settings feature view: ${path}`)
  return view
}
