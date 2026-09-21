import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * P12 门禁：登录修复页必须能在主应用启动失败时仍然可用。
 *
 * 修复页的存在意义，是在主应用因为浏览器数据损坏而**打不开**时给用户一条出路。
 * 因此它只能依赖自带的渲染与文案，不能依赖主应用的 i18n 运行时、Pinia store 或
 * 应用启动链路——否则「应用坏了」就等于「修复页也坏了」。
 *
 * 本文件固定三条契约：
 *   1. `repair.html` 只加载 `src/repair/main.ts` 这一个应用入口；
 *   2. `src/repair/**` 不导入主应用的 i18n、store、router 实例或启动模块；
 *   3. 修复页自带中英文文案，且两级确认与「部分成功」措辞齐备。
 *
 * 构建产物层面的独立性（`repair.html` → `repair-*.js` → 自包含的 `repair-core`，
 * 不引用主入口 chunk）已在 P12 验收中通过真实 `pnpm run build` + 静态访问验证，
 * 见计划文档 §2.18。
 */

const FRONTEND_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** 修复页不得依赖的主应用运行时 */
const FORBIDDEN_IMPORTS = [
  '@/locales',
  '@/stores/',
  '@/components/',
  '@/layouts/',
  '@/views/',
  '@/utils/elementPlusRuntime',
  '@/events',
  '@/router/index',
]

describe('P12 repair page independence', () => {
  it('loads only the dedicated repair entry from repair.html', () => {
    const html = readFileSync(join(FRONTEND_ROOT, 'repair.html'), 'utf8')
    const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])
    expect(scripts).toEqual(['/src/repair/main.ts'])
    // 主应用入口不能在修复页里出现
    expect(html).not.toMatch(/\/src\/main\.ts/)
  })

  it('does not import main-app runtime modules from the repair bundle', () => {
    const offenders: string[] = []
    for (const relative of ['main.ts', 'messages.ts']) {
      const text = readFileSync(join(FRONTEND_ROOT, 'src/repair', relative), 'utf8')
      for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1]
        if (
          FORBIDDEN_IMPORTS.some(
            (blocked) => specifier === blocked || specifier.startsWith(blocked),
          )
        )
          offenders.push(`src/repair/${relative} → ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps self-contained bilingual copy with both confirmations and a partial wording', () => {
    const messages = readFileSync(join(FRONTEND_ROOT, 'src/repair/messages.ts'), 'utf8')
    for (const key of [
      'confirmAuth',
      'confirmAll',
      'confirmAgain',
      'done',
      'partial',
      'failed',
      'unknown',
    ]) {
      const occurrences = messages.split(`${key}:`).length - 1
      // 中英各一份
      expect(occurrences, `${key} must exist for both locales`).toBeGreaterThanOrEqual(2)
    }
  })
})
