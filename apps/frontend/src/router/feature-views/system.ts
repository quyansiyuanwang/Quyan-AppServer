import type { Component } from 'vue'

const views = import.meta.glob<Component>('../../views/system/**/*.vue', {
  eager: true,
  import: 'default',
})

export const getView = (path: string): Component => {
  const view = views[`../../views/system/${path}`]
  if (!view) throw new Error(`Unknown system feature view: ${path}`)
  return view
}
