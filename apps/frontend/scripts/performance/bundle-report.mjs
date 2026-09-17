import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { brotliCompressSync, gzipSync } from 'node:zlib'

const REPORT_VERSION = 1
const METRICS = [
  'assetCount',
  'jsCount',
  'cssCount',
  'rawBytes',
  'gzipBytes',
  'brotliBytes',
  'staticDepth',
]

const outputFile = (directory, file) => {
  if (typeof file !== 'string' || !file || isAbsolute(file))
    throw new Error(`Invalid output asset: ${file}`)
  const target = realpathSync(resolve(directory, file))
  const path = relative(realpathSync(directory), target)
  if (path === '..' || path.startsWith('../') || path.startsWith('..\\') || isAbsolute(path)) {
    throw new Error(`Asset escapes build output: ${file}`)
  }
  return target
}

/** Reports actual module boundaries, not guessed pages or complete first-screen waterfalls. */
export const analyzeManifest = (manifest, directory) => {
  const sizes = new Map()
  const closures = new Map()
  const measure = (file) => {
    if (!sizes.has(file)) {
      const source = readFileSync(outputFile(directory, file))
      sizes.set(file, {
        rawBytes: source.length,
        gzipBytes: gzipSync(source).length,
        brotliBytes: brotliCompressSync(source).length,
      })
    }
    return sizes.get(file)
  }
  const visit = (key, stack = new Set()) => {
    if (stack.has(key)) throw new Error(`Static dependency cycle: ${[...stack, key].join(' -> ')}`)
    if (closures.has(key)) return closures.get(key)
    const chunk = manifest[key]
    if (!chunk || typeof chunk.file !== 'string')
      throw new Error(`Missing manifest dependency: ${key}`)
    const assets = new Set([chunk.file, ...(chunk.css ?? [])])
    let depth = 1
    for (const dependency of chunk.imports ?? []) {
      const child = visit(dependency, new Set(stack).add(key))
      for (const asset of child.assets) assets.add(asset)
      depth = Math.max(depth, child.depth + 1)
    }
    const closure = { assets, depth }
    closures.set(key, closure)
    return closure
  }
  const boundaries = Object.entries(manifest).filter(
    ([, chunk]) => chunk?.isEntry || chunk?.isDynamicEntry,
  )
  if (!boundaries.some(([, chunk]) => chunk.isEntry)) throw new Error('Missing Vite entry')
  const entries = Object.fromEntries(
    boundaries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, chunk]) => {
        const { assets, depth } = visit(key)
        const totals = { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 }
        for (const asset of assets)
          for (const metric of Object.keys(totals)) totals[metric] += measure(asset)[metric]
        return [
          key,
          {
            kind: chunk.isEntry ? 'entry' : 'async',
            assetCount: assets.size,
            jsCount: [...assets].filter((asset) => /\.(?:m?js)$/.test(asset)).length,
            cssCount: [...assets].filter((asset) => asset.endsWith('.css')).length,
            ...totals,
            staticDepth: depth,
            assets: [...assets].sort(),
          },
        ]
      }),
  )
  return { version: REPORT_VERSION, entries }
}

/** Baselines are explicit measured artifacts. Never silently create or relax a limit. */
export const compareReports = (report, baseline, growthPercent) => {
  if (!Number.isFinite(growthPercent) || growthPercent < 0)
    throw new Error('Growth percent must be a non-negative finite number')
  if (
    baseline.version !== REPORT_VERSION ||
    !baseline.entries ||
    !Object.keys(baseline.entries).length
  )
    throw new Error('Unsupported or empty performance baseline')
  const added = Object.keys(report.entries).filter((key) => !Object.hasOwn(baseline.entries, key))
  const removed = Object.keys(baseline.entries).filter((key) => !Object.hasOwn(report.entries, key))
  const regressions = []
  for (const [key, previous] of Object.entries(baseline.entries)) {
    for (const metric of METRICS) {
      if (!Number.isFinite(previous[metric]) || previous[metric] < 0)
        throw new Error(`Invalid baseline metric: ${key}.${metric}`)
      const current = report.entries[key]
      if (!current) continue
      const limit = previous[metric] * (1 + growthPercent / 100)
      if (current[metric] > limit)
        regressions.push({
          entry: key,
          metric,
          previous: previous[metric],
          current: current[metric],
          limit,
        })
    }
  }
  return { added, removed, regressions }
}

const writeJson = (file, data) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

export const main = async (args = process.argv.slice(2)) => {
  const { values } = parseArgs({
    args,
    options: {
      manifest: { type: 'string' },
      'out-dir': { type: 'string' },
      output: { type: 'string' },
      mode: { type: 'string', default: 'production' },
      baseline: { type: 'string' },
      'write-baseline': { type: 'string' },
      'max-growth-percent': { type: 'string' },
    },
  })
  if (values.baseline && values['write-baseline'])
    throw new Error('Comparing and writing a baseline are mutually exclusive')
  if (values.baseline && values['max-growth-percent'] === undefined)
    throw new Error('Specify --max-growth-percent when comparing a baseline')
  if (!values.baseline && values['max-growth-percent'] !== undefined)
    throw new Error('--max-growth-percent requires --baseline')
  let directory, manifestPath
  if (values.manifest) {
    if (!values['out-dir'])
      throw new Error('--manifest requires --out-dir (the asset root must not be guessed)')
    directory = resolve(values['out-dir'])
    manifestPath = resolve(values.manifest)
  } else {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const { resolveConfig } = await import('vite')
    const previousCwd = process.cwd()
    let config
    try {
      process.chdir(root)
      config = await resolveConfig({ root, mode: values.mode }, 'build')
    } finally {
      process.chdir(previousCwd)
    }
    if (!config.build.manifest) throw new Error('Enable build.manifest in Vite before reporting')
    directory = resolve(config.root, values['out-dir'] ?? config.build.outDir)
    manifestPath = resolve(
      directory,
      typeof config.build.manifest === 'string' ? config.build.manifest : '.vite/manifest.json',
    )
  }
  const report = analyzeManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), directory)
  const output = resolve(values.output ?? resolve(directory, 'performance-bundle.json'))
  if (values.baseline && resolve(values.baseline) === output)
    throw new Error('Report output must not overwrite its baseline')
  let comparison
  if (values.baseline)
    comparison = compareReports(
      report,
      JSON.parse(readFileSync(values.baseline, 'utf8')),
      Number(values['max-growth-percent']),
    )
  writeJson(output, { ...report, ...(comparison ? { comparison } : {}) })
  if (values['write-baseline']) writeJson(resolve(values['write-baseline']), report)
  console.table(
    Object.fromEntries(
      Object.entries(report.entries)
        .filter(([, entry]) => entry.kind === 'entry')
        .map(([key, { assets: _assets, ...metrics }]) => [key, metrics]),
    ),
  )
  console.info(
    `[performance] ${Object.keys(report.entries).length} discovered module boundaries; report: ${output}`,
  )
  if (comparison) {
    if (comparison.added.length || comparison.removed.length)
      throw new Error(
        'Module boundaries changed; review added/removed entries in the report and explicitly approve a new baseline',
      )
    if (comparison.regressions.length)
      throw new Error(
        `Performance budget exceeded (${comparison.regressions.length} metrics); see report`,
      )
  }
  return report
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
