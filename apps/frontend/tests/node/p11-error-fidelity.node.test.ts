import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * P11 门禁：前端不得丢弃后端给出的具体失败原因。
 *
 * 背景（见 .tmp/backend-i18n-refactor-plan.md §3「前端信息保真」）：
 * 后端已把全部业务错误迁移为类型安全的可本地化描述符，出口按 `X-Locale`
 * 渲染成中英文。若前端在 catch 中直接弹出硬编码兜底文案，用户就看不到后端
 * 给出的具体原因（例如「权限不足」会被压成「加载失败」）。
 *
 * 本文件固定三条契约：
 *   1. catch 中的用户提示必须把「捕获到的错误」交给错误感知的 helper
 *      （`getErrorMessage(error, fallback)` 或 `showRequestErrorNotice(error, fallback)`），
 *      由 helper 决定「后端原因优先、兜底次之」；仅出现 helper 名字但传的不是该
 *      catch 的绑定名不算通过（这正是本地扫描第一个版本误判 213 处的原因）。
 *   2. 不存在各视图自带的 `resolveErrorMessage` / `toErrorMessage` 副本——它们会
 *      泄漏任意 `error.message`（含网络层英文），与统一 helper 的语义冲突。
 *   3. 会把后端 message 呈现给用户的直连 fetch 必须携带 `X-Locale`。
 */

const SRC_ROOT = fileURLToPath(new URL('../../src/', import.meta.url))

/**
 * 已复核的例外：`try` 体是本地 `JSON.parse`，与后端无关，
 * 硬编码提示才是正确行为（后端 message 在此不存在）。
 */
const REVIEWED_LOCAL_ONLY = new Set(['views/relay/relay-settings/useRelaySettingsManagement.ts'])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|vue)$/.test(entry)) out.push(full)
  }
  return out
}

/** 从 `{` 或 `(` 开始，返回配对结束符的下标（跳过字符串字面量） */
function matchPair(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0
  let inString: string | null = null
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i]
    const prev = text[i - 1]
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

const sourceFiles = walk(SRC_ROOT).filter(
  (file) => !/[\\/](locales|i18n|client)[\\/]/.test(file) && !file.endsWith('.gen.ts'),
)
const rel = (file: string) => relative(SRC_ROOT, file).split('\\').join('/')

describe('P11 frontend error fidelity', () => {
  it('hands the caught error to the shared helper in every user-facing notice', () => {
    const offenders: string[] = []

    for (const file of sourceFiles) {
      const path = rel(file)
      if (REVIEWED_LOCAL_ONLY.has(path)) continue
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\bcatch\b[^{]*\{/g)) {
        const openIndex = match.index + match[0].length - 1
        const closeIndex = matchPair(text, openIndex, '{', '}')
        if (closeIndex < 0) continue
        const body = text.slice(openIndex + 1, closeIndex)
        if (!/ElMessage\.(error|warning)\(|showRequestErrorNotice\(/.test(body)) continue
        if (/\b\w+\.message\b/.test(body)) continue
        const binding = (match[0].match(/\bcatch\s*\(\s*(\w+)/) ?? [])[1]
        const errorAware =
          binding !== undefined &&
          new RegExp(`(getErrorMessage|showRequestErrorNotice)\\(\\s*${binding}\\b`).test(body)
        if (errorAware) continue
        offenders.push(`${path}:${text.slice(0, match.index).split('\n').length}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps one shared error-message helper instead of per-view copies', () => {
    const duplicates: string[] = []
    for (const file of sourceFiles) {
      if (/const\s+(resolveErrorMessage|toErrorMessage)\s*=/.test(readFileSync(file, 'utf8')))
        duplicates.push(rel(file))
    }
    expect(duplicates).toEqual([])
  })

  it('sends X-Locale from every backend fetch that can surface a message', () => {
    // 遥测、静态资源、以及只解析业务字段（不展示 message）的调用点不在此列，
    // 已在计划文档 §3 记录为有意豁免。
    const requiresLocale = [
      'service/developerProductService.ts',
      'service/replaySigningService.ts',
      'service/agentService.ts',
      'service/socialAuthService.ts',
      'utils/public-request.ts',
      'stores/request.ts',
    ]
    const missing = requiresLocale.filter((path) => {
      const text = readFileSync(join(SRC_ROOT, path), 'utf8')
      return !(
        text.includes('localeHeaders(') ||
        text.includes('getLocaleHeaders(') ||
        /['"]X-Locale['"]\s*:/.test(text)
      )
    })
    expect(missing).toEqual([])
  })

  it('keeps the locale header helper as the single source of the X-Locale contract', () => {
    const helper = readFileSync(join(SRC_ROOT, 'utils/public-request.ts'), 'utf8')
    expect(helper).toMatch(/export const localeHeaders/)
    expect(helper).toContain("'X-Locale'")
  })
})
