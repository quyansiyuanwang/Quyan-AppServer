import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import http from 'highlight.js/lib/languages/http'
import ini from 'highlight.js/lib/languages/ini'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('python', python)
hljs.registerLanguage('http', http)
hljs.registerLanguage('ini', ini)
hljs.registerAliases('env', { languageName: 'ini' })

export const highlightCode = (source: string, language: string): string | undefined => {
  if (!hljs.getLanguage(language)) return undefined
  return hljs.highlight(source, { language, ignoreIllegals: true }).value
}
