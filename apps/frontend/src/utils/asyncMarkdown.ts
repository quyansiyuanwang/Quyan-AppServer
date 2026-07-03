let markedModulePromise: Promise<typeof import('marked')> | null = null
let sanitizeHtmlPromise: Promise<typeof import('dompurify').default> | null = null
let highlightModulePromise: Promise<typeof import('highlight.js/lib/core').default> | null = null

const loadMarkedModule = async () => {
  markedModulePromise ??= import('marked')
  return markedModulePromise
}

const loadSanitizer = async () => {
  sanitizeHtmlPromise ??= import('dompurify').then((module) => module.default)
  return sanitizeHtmlPromise
}

const loadHighlighter = async () => {
  highlightModulePromise ??= Promise.all([
    import('highlight.js/lib/core'),
    import('highlight.js/lib/languages/bash'),
    import('highlight.js/lib/languages/cpp'),
    import('highlight.js/lib/languages/csharp'),
    import('highlight.js/lib/languages/css'),
    import('highlight.js/lib/languages/go'),
    import('highlight.js/lib/languages/http'),
    import('highlight.js/lib/languages/java'),
    import('highlight.js/lib/languages/javascript'),
    import('highlight.js/lib/languages/json'),
    import('highlight.js/lib/languages/kotlin'),
    import('highlight.js/lib/languages/markdown'),
    import('highlight.js/lib/languages/php'),
    import('highlight.js/lib/languages/python'),
    import('highlight.js/lib/languages/rust'),
    import('highlight.js/lib/languages/shell'),
    import('highlight.js/lib/languages/sql'),
    import('highlight.js/lib/languages/swift'),
    import('highlight.js/lib/languages/typescript'),
    import('highlight.js/lib/languages/xml'),
    import('highlight.js/lib/languages/yaml'),
  ]).then(
    ([
      core,
      bash,
      cpp,
      csharp,
      css,
      go,
      http,
      java,
      javascript,
      json,
      kotlin,
      markdown,
      php,
      python,
      rust,
      shell,
      sql,
      swift,
      typescript,
      xml,
      yaml,
    ]) => {
      const hljs = core.default
      hljs.registerLanguage('bash', bash.default)
      hljs.registerLanguage('sh', shell.default)
      hljs.registerLanguage('shell', shell.default)
      hljs.registerLanguage('c', cpp.default)
      hljs.registerLanguage('cpp', cpp.default)
      hljs.registerLanguage('csharp', csharp.default)
      hljs.registerLanguage('cs', csharp.default)
      hljs.registerLanguage('css', css.default)
      hljs.registerLanguage('go', go.default)
      hljs.registerLanguage('http', http.default)
      hljs.registerLanguage('java', java.default)
      hljs.registerLanguage('javascript', javascript.default)
      hljs.registerLanguage('js', javascript.default)
      hljs.registerLanguage('json', json.default)
      hljs.registerLanguage('kotlin', kotlin.default)
      hljs.registerLanguage('kt', kotlin.default)
      hljs.registerLanguage('markdown', markdown.default)
      hljs.registerLanguage('md', markdown.default)
      hljs.registerLanguage('php', php.default)
      hljs.registerLanguage('python', python.default)
      hljs.registerLanguage('py', python.default)
      hljs.registerLanguage('rust', rust.default)
      hljs.registerLanguage('rs', rust.default)
      hljs.registerLanguage('sql', sql.default)
      hljs.registerLanguage('swift', swift.default)
      hljs.registerLanguage('typescript', typescript.default)
      hljs.registerLanguage('ts', typescript.default)
      hljs.registerLanguage('html', xml.default)
      hljs.registerLanguage('xml', xml.default)
      hljs.registerLanguage('yaml', yaml.default)
      hljs.registerLanguage('yml', yaml.default)
      return hljs
    },
  )
  return highlightModulePromise
}

const makeHeadingId = (text: string): string =>
  text
    .replace(/<[^>]*>/g, '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')

const normalizeMarkedResult = (value: string | Promise<string>): Promise<string> =>
  Promise.resolve(value)

export const sanitizeHtml = async (html: string): Promise<string> => {
  const DOMPurify = await loadSanitizer()
  return DOMPurify.sanitize(html)
}

export const renderChatMarkdown = async (content: string): Promise<string> => {
  if (!content) return ''

  const { marked } = await loadMarkedModule()
  const raw = await normalizeMarkedResult(
    marked.parse(content, {
      breaks: true,
      gfm: true,
    }),
  )

  return sanitizeHtml(raw)
}

export const renderArticleMarkdown = async (content: string): Promise<string> => {
  if (!content) return ''

  const { marked, Renderer } = await loadMarkedModule()
  const renderer = new Renderer()
  renderer.heading = ({ text, depth }: { text: string; depth: number }) => {
    const id = makeHeadingId(text)
    return `<h${depth} id="${id}">${text}</h${depth}>\n`
  }

  const raw = await normalizeMarkedResult(marked.parse(content, { async: false, renderer }))
  return sanitizeHtml(raw)
}

export const highlightCodeBlocks = async (root: ParentNode | null | undefined): Promise<void> => {
  if (!root) return

  const hljs = await loadHighlighter()
  const codeBlocks = root.querySelectorAll('pre code')
  codeBlocks.forEach((block) => {
    hljs.highlightElement(block as HTMLElement)
  })
}
