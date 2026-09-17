import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { brotliCompressSync } from 'node:zlib'
import {
  analyzeManifest,
  compareReports,
  main,
} from '../../../scripts/performance/bundle-report.mjs'

const temporaryRoots: string[] = []
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'quyan-performance-test-'))
  temporaryRoots.push(directory)
  const out = join(directory, 'output')
  mkdirSync(join(out, 'assets'), { recursive: true })
  for (const file of [
    'main.js',
    'shared.js',
    'feature.js',
    'another.js',
    'main.css',
    'feature.css',
  ]) {
    writeFileSync(join(out, 'assets', file), `/* ${file} fixture */`)
  }
  const manifest = {
    'shell.html': {
      file: 'assets/main.js',
      isEntry: true,
      imports: ['shared'],
      css: ['assets/main.css'],
      dynamicImports: ['feature.vue'],
    },
    shared: { file: 'assets/shared.js' },
    'feature.vue': {
      file: 'assets/feature.js',
      isDynamicEntry: true,
      imports: ['shared'],
      css: ['assets/feature.css'],
    },
  }
  return { directory, out, manifest }
}
afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    // Only delete this suite's freshly allocated OS temp directories.
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('quyan-performance-test-')
    )
      throw new Error('Unsafe test cleanup')
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('manifest-driven performance reports', () => {
  it('discovers arbitrary entry names and keeps dynamic children outside static closures', () => {
    const { manifest, out } = fixture()
    const report = analyzeManifest(manifest, out)
    expect(Object.keys(report.entries)).toEqual(['feature.vue', 'shell.html'])
    expect(report.entries['shell.html'].assets).toEqual([
      'assets/main.css',
      'assets/main.js',
      'assets/shared.js',
    ])
    expect(report.entries['feature.vue']).toMatchObject({
      kind: 'async',
      staticDepth: 2,
      assetCount: 3,
    })
  })
  it('automatically includes new async boundaries and additional HTML entries', () => {
    const { manifest, out } = fixture()
    const report = analyzeManifest(
      {
        ...manifest,
        'new-feature.vue': { file: 'assets/another.js', isDynamicEntry: true },
        'other.html': { file: 'assets/main.js', isEntry: true },
      },
      out,
    )
    expect(Object.keys(report.entries)).toContain('new-feature.vue')
    expect(report.entries['other.html'].kind).toBe('entry')
  })
  it('deduplicates shared assets and compresses each file separately', () => {
    const { manifest, out } = fixture()
    manifest['shell.html'].imports.push('shared')
    const entry = analyzeManifest(manifest, out).entries['shell.html']
    expect(entry.assetCount).toBe(3)
    expect(entry.brotliBytes).toBe(
      entry.assets.reduce(
        (sum: number, file: string) =>
          sum + brotliCompressSync(readFileSync(join(out, file))).length,
        0,
      ),
    )
  })
  it('rejects cycles, missing dependencies and paths escaping the output directory', () => {
    const { manifest, out, directory } = fixture()
    expect(() =>
      analyzeManifest(
        { ...manifest, shared: { file: 'assets/shared.js', imports: ['shell.html'] } },
        out,
      ),
    ).toThrow('cycle')
    expect(() => analyzeManifest({ ...manifest, shared: undefined }, out)).toThrow(
      'Missing manifest dependency',
    )
    writeFileSync(join(directory, 'outside.js'), 'outside')
    expect(() => analyzeManifest({ entry: { file: '../outside.js', isEntry: true } }, out)).toThrow(
      'escapes',
    )
  })
  it('compares stable manifest keys rather than content hashes with explicit tolerance', () => {
    const { manifest, out } = fixture()
    const baseline = analyzeManifest(manifest, out)
    const current = structuredClone(baseline)
    current.entries['shell.html'].assets = ['assets/main-newhash.js']
    expect(compareReports(current, baseline, 0).regressions).toEqual([])
    current.entries['shell.html'].rawBytes += 1
    expect(compareReports(current, baseline, 0).regressions).toHaveLength(1)
    expect(compareReports(current, baseline, 100).regressions).toEqual([])
    expect(() => compareReports(current, baseline, -1)).toThrow('non-negative')
  })
  it('reports added and removed boundaries instead of silently dropping coverage', () => {
    const { manifest, out } = fixture()
    const baseline = analyzeManifest(manifest, out)
    const current = analyzeManifest(
      { 'other.html': { file: 'assets/main.js', isEntry: true } },
      out,
    )
    expect(compareReports(current, baseline, 0)).toMatchObject({
      added: ['other.html'],
      removed: ['feature.vue', 'shell.html'],
    })
  })
  it('supports an explicit manifest without loading application configuration or fabricating a baseline', async () => {
    const { manifest, out, directory } = fixture()
    const input = join(directory, 'manifest.json')
    const output = join(directory, 'report.json')
    writeFileSync(input, JSON.stringify(manifest))
    await main(['--manifest', input, '--out-dir', out, '--output', output])
    expect(JSON.parse(readFileSync(output, 'utf8')).entries['shell.html'].kind).toBe('entry')
    await expect(main(['--manifest', input])).rejects.toThrow('--out-dir')
    await expect(
      main(['--manifest', input, '--out-dir', out, '--baseline', output]),
    ).rejects.toThrow('--max-growth-percent')
    await expect(
      main([
        '--manifest',
        input,
        '--out-dir',
        out,
        '--output',
        output,
        '--baseline',
        output,
        '--max-growth-percent',
        '0',
      ]),
    ).rejects.toThrow('overwrite')
  })
})
