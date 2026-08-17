let markdownRendererPromise: Promise<typeof import('./markdown-renderer-runtime')> | null = null
let markdownHighlighterPromise: Promise<typeof import('./markdown-highlighter-runtime')> | null =
  null

const loadMarkdownRenderer = () =>
  (markdownRendererPromise ??= import('./markdown-renderer-runtime'))

const loadMarkdownHighlighter = () =>
  (markdownHighlighterPromise ??= import('./markdown-highlighter-runtime'))

export const sanitizeHtml = async (html: string): Promise<string> =>
  (await loadMarkdownRenderer()).sanitizeHtml(html)

export const renderChatMarkdown = async (content: string): Promise<string> =>
  (await loadMarkdownRenderer()).renderChatMarkdown(content)

export const renderArticleMarkdown = async (content: string): Promise<string> =>
  (await loadMarkdownRenderer()).renderArticleMarkdown(content)

export const highlightCodeBlocks = async (root: ParentNode | null | undefined): Promise<void> =>
  (await loadMarkdownHighlighter()).highlightCodeBlocks(root)

/** Return escaped, syntax-highlighted HTML for trusted display in a code block. */
export const highlightCode = async (code: string, language: string): Promise<string> =>
  (await loadMarkdownHighlighter()).highlightCode(code, language)
