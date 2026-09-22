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

/**
 * 原生出口点：`fetch`/`axios`/`WebSocket`/`EventSource`/`XMLHttpRequest`/`sendBeacon`
 * 不经过 `stores/request.ts`，因此语言头必须由调用点自行提供。
 * 注释与字符串字面量先剔除，避免把文档说明或「用户脚本检测模式」当成真实出口。
 */
const RAW_EGRESS_PATTERNS = [
  /\bfetch\s*\(/,
  /\baxios\s*\./,
  /new\s+WebSocket\s*\(/,
  /new\s+EventSource\s*\(/,
  /new\s+XMLHttpRequest\s*\(/,
  /\bsendBeacon\s*\(/,
]

/** 请求语言只有一个来源：`localeHeaders()` / 请求层的 `getLocaleHeaders()`。 */
const LOCALE_BEARING = /localeHeaders\(|getLocaleHeaders\(|['"]X-Locale['"]\s*:/

/** SSE 传输层不构造语言头，调用点必须提供（`prepareStreamingRequest` 已含语言头）。 */
const TRANSPORT_CALLER_LOCALE = /localeHeaders\(|getLocaleHeaders\(|prepareStreamingRequest\(/

/**
 * 已复核豁免：出口指向的不是本项目后端，或响应中的 `message` 不会呈现给用户。
 * 每一项都必须写明原因；新增原生出口点必须在此登记，否则
 * 「classifies every raw HTTP egress」失败。
 */
const REVIEWED_EGRESS_EXEMPTIONS: Record<string, string> = {
  'config/auto-update.ts': '抓取自身 index.html 探测构建版本，不是后端接口',
  'service/streaming/sse.ts': 'SSE 传输层，语言头由调用点注入（由传输层调用点测试锁定）',
  'utils/captcha.ts': '公开验证码配置，只读取 provider/enabled，响应 message 不呈现',
  'utils/http-client.ts': '通用传输层，唯一消费者是遥测 tracker，响应 message 不呈现',
  'utils/heatmap/collector.ts': '热力图遥测，失败仅重新入队，响应 message 不呈现',
  'views/debug/DebugView.vue': 'axios 直连用户填写的第三方中转地址，非本项目后端',
  'views/products/remote-terminal-cloud/my-remote-terminal-products/useMyRemoteTerminalProducts.ts':
    'RTC 版本列表只取 tags 字段，失败置本地错误标志',
  'views/products/remote-terminal-cloud/remote-terminal/useRemoteTerminalManagement.ts':
    'WebSocket 握手无法携带自定义请求头（协议限制）',
}

/** `/` 出现在这些字符之后时按正则字面量处理（启发式，避免正则里的引号吞掉真实代码）。 */
const REGEX_AFTER_CHAR = new Set([
  '',
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
])
const REGEX_AFTER_KEYWORD = new Set([
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'do',
  'else',
  'void',
  'delete',
  'throw',
  'new',
  'yield',
  'await',
  'instanceof',
])

/**
 * 剔除注释、字符串与正则字面量，保留换行以维持行号。
 * 只覆盖标记所需的语法子集：模板字面量按普通代码处理（不会漏掉其中的出口点）。
 */
function stripCommentsAndStrings(text: string): string {
  let out = ''
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'regex' = 'code'
  let inCharacterClass = false

  const startsRegex = (): boolean => {
    const trailingWord = /([A-Za-z_$][\w$]*)\s*$/.exec(out)
    if (trailingWord) return REGEX_AFTER_KEYWORD.has(trailingWord[1])
    return REGEX_AFTER_CHAR.has(out.trimEnd().slice(-1))
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line'
        i += 1
      } else if (ch === '/' && next === '*') {
        state = 'block'
        i += 1
      } else if (ch === '/' && startsRegex()) {
        state = 'regex'
      } else if (ch === "'") {
        state = 'single'
      } else if (ch === '"') {
        state = 'double'
      } else {
        out += ch
      }
      continue
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code'
        out += '\n'
      }
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code'
        i += 1
      } else if (ch === '\n') {
        out += '\n'
      }
      continue
    }
    if (state === 'regex') {
      if (ch === '\\') i += 1
      else if (ch === '[') inCharacterClass = true
      else if (ch === ']') inCharacterClass = false
      else if (ch === '/' && !inCharacterClass) state = 'code'
      continue
    }
    if (ch === '\\') i += 1
    else if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"'))
      state = 'code'
    else if (ch === '\n') out += '\n'
  }
  return out
}

/** 含原生出口点的源文件（不含注释与字符串字面量中的假阳性）。 */
function rawEgressFiles(): string[] {
  return sourceFiles.filter((file) => {
    const code = stripCommentsAndStrings(readFileSync(file, 'utf8'))
    return RAW_EGRESS_PATTERNS.some((pattern) => pattern.test(code))
  })
}

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

  it('keeps the locale header helper as the single source of the X-Locale contract', () => {
    const helper = readFileSync(join(SRC_ROOT, 'utils/public-request.ts'), 'utf8')
    expect(helper).toMatch(/export const localeHeaders/)
    expect(helper).toContain("'X-Locale'")
  })

  it('classifies every raw HTTP egress that bypasses the request layer', () => {
    const offenders = rawEgressFiles()
      .filter((file) => !LOCALE_BEARING.test(readFileSync(file, 'utf8')))
      .filter((file) => !(rel(file) in REVIEWED_EGRESS_EXEMPTIONS))
      .map(rel)

    expect(offenders).toEqual([])
  })

  it('keeps the raw-egress exemption ledger honest', () => {
    const files = new Set(rawEgressFiles().map(rel))
    const stale = Object.keys(REVIEWED_EGRESS_EXEMPTIONS).filter((path) => !files.has(path))
    expect(stale).toEqual([])

    const unreasoned = Object.entries(REVIEWED_EGRESS_EXEMPTIONS)
      .filter(([, reason]) => reason.trim().length < 10)
      .map(([path]) => path)
    expect(unreasoned).toEqual([])
  })

  it('passes a locale to every transport that takes its headers from the caller', () => {
    // `service/streaming/sse.ts` 只是 SSE 传输层，语言头由调用点提供。
    const callers = sourceFiles.filter((file) =>
      /new SSEStream\(|createSseClient\(/.test(readFileSync(file, 'utf8')),
    )
    expect(callers.map(rel).sort()).toEqual([
      'service/agentService.ts',
      'service/chatService.ts',
      'service/socialAuthService.ts',
    ])

    const missing = callers
      .filter((file) => !TRANSPORT_CALLER_LOCALE.test(readFileSync(file, 'utf8')))
      .map(rel)
    expect(missing).toEqual([])
  })
})
