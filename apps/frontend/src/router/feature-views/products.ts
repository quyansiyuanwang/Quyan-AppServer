import type { Component } from 'vue'

const views = import.meta.glob<Component>('../../views/products/**/*.vue', {
  eager: true,
  import: 'default',
})

export const getView = (path: string): Component => {
  const view = views[`../../views/products/${path}`]
  if (!view) throw new Error(`Unknown products feature view: ${path}`)
  return view
}
