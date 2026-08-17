import DOMPurify from 'dompurify'
import { marked, Renderer } from 'marked'

const makeHeadingId = (text: string): string =>
  text
    .replace(/<[^>]*>/g, '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')

const normalizeMarkedResult = (value: string | Promise<string>): Promise<string> =>
  Promise.resolve(value)

export const sanitizeHtml = (html: string): string => DOMPurify.sanitize(html)

export const renderChatMarkdown = async (content: string): Promise<string> => {
  if (!content) return ''

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

  const renderer = new Renderer()
  renderer.heading = ({ text, depth }: { text: string; depth: number }) => {
    const id = makeHeadingId(text)
    return `<h${depth} id="${id}">${text}</h${depth}>\n`
  }

  const raw = await normalizeMarkedResult(marked.parse(content, { async: false, renderer }))
  return sanitizeHtml(raw)
}
