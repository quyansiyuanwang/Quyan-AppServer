import {
  IAM_ACTION_DEFINITIONS,
  IAM_CONDITION_KEY_CATALOG,
  IAM_RESOURCE_TYPE_CATALOG,
  iamServiceDefinitions,
} from '../../../packages/shared/src/iam'
import { SUPPORT_KNOWLEDGE_SECTION_CHARACTERS } from '../../../packages/shared/src/support-knowledge'

export interface KnowledgeSection {
  heading: string
  content: string
}

/** Strip presentation syntax only. Code blocks and inline code are protocol data, not Markdown. */
export function cleanKnowledgeMarkdown(markdown: string): string {
  const code: string[] = []
  const protect = (text: string) => `\u0000CODE${code.push(text) - 1}\u0000`
  return markdown
    .replace(/```[^\r\n]*(?:\r?\n)([\s\S]*?)```/g, (_match, content: string) =>
      protect(content.trimEnd()),
    )
    .replace(/`([^`\r\n]+)`/g, (_match, content: string) => protect(content))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?([a-zA-Z][\w-]*)(?:\s[^>]*)?>/g, ' $1 ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\u0000CODE(\d+)\u0000/g, (_match, index: string) => code[Number(index)] ?? '')
    .trim()
}

/** Split at line boundaries where possible; joining with a newline preserves complete JSON examples. */
export function splitKnowledgeContent(content: string): string[] {
  const chunks: string[] = []
  let current = ''
  const limit = SUPPORT_KNOWLEDGE_SECTION_CHARACTERS
  for (const line of content.split('\n')) {
    if (current && current.length + line.length + 1 > limit) {
      chunks.push(current)
      current = ''
    }
    let remaining = line
    while (remaining.length > limit) {
      chunks.push(remaining.slice(0, limit))
      remaining = remaining.slice(limit)
    }
    current = current ? `${current}\n${remaining}` : remaining
  }
  if (current) chunks.push(current)
  return chunks
}

export function splitKnowledgeSections(
  markdown: string,
  fallbackTitle: string,
): KnowledgeSection[] {
  // Fenced-code headings cannot create artificial knowledge sections.
  let fenced = false
  let offset = 0
  const headings: { start: number; heading: string }[] = []
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced
    else if (!fenced) {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
      if (match) headings.push({ start: offset, heading: match[2]! })
    }
    offset += line.length + 1
  }
  if (!headings.length || headings[0]!.start > 0)
    headings.unshift({ start: 0, heading: fallbackTitle })
  return headings.flatMap((entry, index) =>
    splitKnowledgeContent(
      cleanKnowledgeMarkdown(markdown.slice(entry.start, headings[index + 1]?.start)),
    ).map((content) => ({ heading: entry.heading, content })),
  )
}

/** Append authoritative catalog sections to RAM; never maintain another Action/ARN/condition registry. */
export function iamKnowledgeSections(locale: 'zh-CN' | 'en'): KnowledgeSection[] {
  const prefix = locale === 'zh-CN' ? 'RAM 服务目录' : 'RAM service catalog'
  const sections: KnowledgeSection[] = []
  const append = (heading: string, value: unknown) => {
    const parts = splitKnowledgeContent(JSON.stringify(value, null, 2))
    parts.forEach((content, index) =>
      sections.push({ heading: `${heading} [${index + 1}/${parts.length}]`, content }),
    )
  }
  for (const service of iamServiceDefinitions()) {
    for (const action of service.actions) {
      // Include every registered authorization boundary/dependency, not inferred grants or API names.
      append(`${prefix}: ${service.code} / ${action.action}`, action)
    }
  }
  for (const resource of IAM_RESOURCE_TYPE_CATALOG)
    append(`${prefix}: ARN ${resource.id}`, resource)
  for (const condition of IAM_CONDITION_KEY_CATALOG)
    append(`${prefix}: Condition ${condition.key}`, condition)
  return sections
}

export function iamKnowledgeSearchText(): string {
  return [
    'RAM IAM JSON Action Resource Condition Principal trust delegation Schema 显式拒绝 默认拒绝 信任 委派 诊断',
    ...IAM_ACTION_DEFINITIONS.map((action) => action.action),
    ...IAM_RESOURCE_TYPE_CATALOG.map((resource) => `${resource.id} ${resource.arnTemplate}`),
    ...IAM_CONDITION_KEY_CATALOG.map((condition) => condition.key),
  ].join('\n')
}
