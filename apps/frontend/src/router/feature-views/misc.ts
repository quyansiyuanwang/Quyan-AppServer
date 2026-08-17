import type { Component } from 'vue'

const views = import.meta.glob<Component>(
  '../../views/{article,chat,common,debug,developer,json-endpoint,oj-submitter,public,user-script,workspace}/**/*.vue',
  { eager: true, import: 'default' },
)

export const getView = (path: string): Component => {
  const view = views[`../../views/${path}`]
  if (!view) throw new Error(`Unknown misc feature view: ${path}`)
  return view
}
