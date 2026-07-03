import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { JSDOM } from 'jsdom'

const DEFAULT_OUTPUT = 'imports/cet4-memory.txt'
const DEFAULT_STEP = 1

const printHelp = () => {
  console.log(`
Usage:
  node scripts/scrape-wendu-words.js [--output <file>] [--start-url <url>] [--step <n>] [--dry-run]

Options:
  --output <file>      Output text file path. Default: ${DEFAULT_OUTPUT}
  --start-url <url>    起始 URL。设置后可一直按回车自动递增抓取。
  --step <n>           每次递增步长，默认 ${DEFAULT_STEP}
  --dry-run            Parse and print result without writing file.

Interactive:
  - 首次输入 URL 后回车: 爬取一次并自动+1
  - 之后直接回车: 抓取当前 URL，并继续自动+1
  - 输入新 URL 后回车: 重置递增序列
  - 输入 q / quit / exit: 退出
`)
}

const parseArgs = (argv) => {
  const args = {
    output: DEFAULT_OUTPUT,
    dryRun: false,
    startUrl: '',
    step: DEFAULT_STEP,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]

    if (token === '--help' || token === '-h') {
      printHelp()
      process.exit(0)
    }

    if (token === '--output' && next) {
      args.output = next
      i += 1
      continue
    }

    if (token === '--start-url' && next) {
      args.startUrl = next
      i += 1
      continue
    }

    if (token === '--step' && next) {
      const parsed = Number(next)
      if (Number.isFinite(parsed) && parsed > 0) {
        args.step = Math.floor(parsed)
      }
      i += 1
      continue
    }

    if (token === '--dry-run') {
      args.dryRun = true
      continue
    }
  }

  return args
}

const normalizeSpace = (value) => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

const normalizeLineKey = (value) => normalizeSpace(value).toLowerCase()

const parseWordLine = (rawLine) => {
  const line = normalizeSpace(rawLine)
  if (!line) return null
  if (!/^[A-Za-z]/.test(line)) return null
  if (/责任编辑|文都四六级网|版权|上一篇|下一篇/.test(line)) return null

  const slashPattern = line.match(/^([A-Za-z][A-Za-z' -]*)\s*\/\s*([^/]+?)\s*\/\s*(.+)$/)
  if (slashPattern) {
    const word = normalizeSpace(slashPattern[1])
    const phonetic = normalizeSpace(slashPattern[2]).replace(/^\/+|\/+$/g, '')
    const tail = normalizeSpace(slashPattern[3]).replace(/^[.。;；:：]+\s*/, '')
    if (!word || !phonetic || !tail) return null
    return `${word}/ ${phonetic}/ ${tail}`
  }

  const withPosPattern = line.match(
    /^([A-Za-z][A-Za-z' -]*)\s+([a-z.]+(?:\s+[a-z.]+)*)\s*\[([^\]]+)]\s*(.+)$/i,
  )

  if (withPosPattern) {
    const word = normalizeSpace(withPosPattern[1])
    const pos = normalizeSpace(withPosPattern[2])
    const phonetic = normalizeSpace(withPosPattern[3]).replace(/^\/+|\/+$/g, '')
    const tailBody = normalizeSpace(withPosPattern[4]).replace(/^[.。;；:：]+\s*/, '')
    const tail = `${pos} ${tailBody}`.trim()

    if (!word || !phonetic || !tail) return null
    return `${word}/ ${phonetic}/ ${tail}`
  }

  const bracketPattern = line.match(/^([A-Za-z][A-Za-z' -]*)\s*\[([^\]]+)]\s*(.+)$/)
  if (bracketPattern) {
    const word = normalizeSpace(bracketPattern[1])
    const phonetic = normalizeSpace(bracketPattern[2]).replace(/^\/+|\/+$/g, '')
    const tail = normalizeSpace(bracketPattern[3]).replace(/^[.。;；:：]+\s*/, '')

    if (!word || !phonetic || !tail) return null
    return `${word}/ ${phonetic}/ ${tail}`
  }

  return null
}

const extractWordsFromHtml = (html) => {
  const dom = new JSDOM(html)
  const articleBody = dom.window.document.querySelector('.article-body') ?? dom.window.document.body

  const paragraphs = [...articleBody.querySelectorAll('p')]
  const lines = paragraphs
    .map((node) => normalizeSpace(node.textContent ?? ''))
    .filter((line) => line.length > 0)

  const parsed = lines.map((line) => parseWordLine(line)).filter((line) => line !== null)

  const seen = new Set()
  const unique = []

  for (const item of parsed) {
    const key = normalizeLineKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }

  return unique
}

const loadExistingKeys = (outputFile) => {
  if (!fs.existsSync(outputFile)) {
    return new Set()
  }

  const content = fs.readFileSync(outputFile, 'utf8')
  const lines = content
    .split(/\r?\n/)
    .map((line) => normalizeSpace(line))
    .filter(Boolean)

  return new Set(lines.map((line) => normalizeLineKey(line)))
}

const appendWordLines = (outputFile, items) => {
  const hasFile = fs.existsSync(outputFile)
  const existing = hasFile ? fs.readFileSync(outputFile, 'utf8') : ''
  const prefix = existing.trim().length > 0 ? '\n\n' : ''
  const body = items.join('\n\n')

  fs.mkdirSync(path.dirname(outputFile), { recursive: true })
  fs.appendFileSync(outputFile, `${prefix}${body}\n`, 'utf8')
}

const fetchHtml = async (url) => {
  const response = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  return response.text()
}

const incrementUrl = (url, step) => {
  const matched = url.match(/^(.*?)(\d+)([^\d]*)$/)
  if (!matched) return null

  const prefix = matched[1]
  const digits = matched[2]
  const suffix = matched[3]

  const nextValue = Number(digits) + step
  const nextDigits = String(nextValue).padStart(digits.length, '0')

  return `${prefix}${nextDigits}${suffix}`
}

const ask = (rl, prompt) => {
  return new Promise((resolve) => {
    if (rl.closed) {
      resolve(null)
      return
    }

    rl.question(prompt, resolve)
  })
}

const run = async () => {
  const args = parseArgs(process.argv.slice(2))
  const outputFile = path.resolve(process.cwd(), args.output)

  const existingKeys = loadExistingKeys(outputFile)
  let currentUrl = normalizeSpace(args.startUrl)

  console.log(`Output file: ${path.relative(process.cwd(), outputFile)}`)
  console.log(`Increment step: +${args.step}`)
  if (currentUrl) {
    console.log(`Start URL: ${currentUrl}`)
  }
  if (args.dryRun) {
    console.log('Dry run mode: will parse but not write file.')
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  let streamClosed = false
  rl.on('close', () => {
    streamClosed = true
  })

  try {
    while (true) {
      const prompt = currentUrl
        ? `回车抓取并+${args.step}（当前: ${currentUrl}）> `
        : '请输入起始 URL（q 退出）> '

      const answer = await ask(rl, prompt)
      if (answer === null || streamClosed) {
        break
      }

      const input = String(answer).trim()

      if (/^(q|quit|exit)$/i.test(input)) {
        break
      }

      const url = input || currentUrl
      if (!url) {
        console.log('请先输入一个有效 URL。')
        continue
      }

      currentUrl = url

      try {
        const html = await fetchHtml(url)
        const parsedItems = extractWordsFromHtml(html)

        if (parsedItems.length === 0) {
          console.log(`未从页面解析到词条: ${url}`)
        } else {
          const freshItems = parsedItems.filter((item) => !existingKeys.has(normalizeLineKey(item)))

          if (args.dryRun) {
            console.log(`解析到 ${parsedItems.length} 条，新增 ${freshItems.length} 条（未写入）。`)
            console.log(freshItems.slice(0, 10).join('\n') || '(全部重复)')
          } else if (freshItems.length === 0) {
            console.log(`解析到 ${parsedItems.length} 条，但都已存在，无新增。`)
          } else {
            appendWordLines(outputFile, freshItems)
            for (const item of freshItems) {
              existingKeys.add(normalizeLineKey(item))
            }

            console.log(`完成：解析 ${parsedItems.length} 条，新增写入 ${freshItems.length} 条。`)
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`抓取失败: ${message}`)
      }

      const nextUrl = incrementUrl(url, args.step)
      if (nextUrl) {
        currentUrl = nextUrl
        console.log(`下一条 URL: ${currentUrl}`)
      } else {
        currentUrl = ''
        console.log('当前 URL 中未找到可递增数字，请手动输入新的 URL。')
      }
    }
  } finally {
    if (!rl.closed) {
      rl.close()
    }
  }

  console.log('已退出。')
}

void run()
