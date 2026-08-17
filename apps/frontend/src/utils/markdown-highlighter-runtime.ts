import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import http from 'highlight.js/lib/languages/http'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

let registered = false

const ensureRegistered = () => {
  if (registered) return

  hljs.registerLanguage('bash', bash)
  hljs.registerLanguage('sh', shell)
  hljs.registerLanguage('shell', shell)
  hljs.registerLanguage('c', cpp)
  hljs.registerLanguage('cpp', cpp)
  hljs.registerLanguage('csharp', csharp)
  hljs.registerLanguage('cs', csharp)
  hljs.registerLanguage('css', css)
  hljs.registerLanguage('go', go)
  hljs.registerLanguage('http', http)
  hljs.registerLanguage('java', java)
  hljs.registerLanguage('javascript', javascript)
  hljs.registerLanguage('js', javascript)
  hljs.registerLanguage('json', json)
  hljs.registerLanguage('kotlin', kotlin)
  hljs.registerLanguage('kt', kotlin)
  hljs.registerLanguage('markdown', markdown)
  hljs.registerLanguage('md', markdown)
  hljs.registerLanguage('php', php)
  hljs.registerLanguage('python', python)
  hljs.registerLanguage('py', python)
  hljs.registerLanguage('rust', rust)
  hljs.registerLanguage('rs', rust)
  hljs.registerLanguage('sql', sql)
  hljs.registerLanguage('swift', swift)
  hljs.registerLanguage('typescript', typescript)
  hljs.registerLanguage('ts', typescript)
  hljs.registerLanguage('html', xml)
  hljs.registerLanguage('xml', xml)
  hljs.registerLanguage('yaml', yaml)
  hljs.registerLanguage('yml', yaml)
  registered = true
}

export const highlightCodeBlocks = (root: ParentNode | null | undefined): void => {
  if (!root) return

  ensureRegistered()
  root.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block as HTMLElement)
  })
}

/** Return escaped, syntax-highlighted HTML for trusted display in a code block. */
export const highlightCode = (code: string, language: string): string => {
  if (!code) return ''
  ensureRegistered()
  return hljs.highlight(code, { language }).value
}
