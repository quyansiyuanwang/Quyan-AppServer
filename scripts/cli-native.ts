import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

type Target = 'windows-x64' | 'linux-x64' | 'linux-arm64' | 'macos-x64' | 'macos-arm64'

const root = path.resolve(import.meta.dirname, '..')
const crate = path.join(root, 'apps', 'cli-native')
const release = path.join(crate, 'dist', 'release')
const targets: Record<Target, { rust: string; extension: string }> = {
  'windows-x64': { rust: 'x86_64-pc-windows-msvc', extension: '.exe' },
  'linux-x64': { rust: 'x86_64-unknown-linux-musl', extension: '' },
  'linux-arm64': { rust: 'aarch64-unknown-linux-musl', extension: '' },
  'macos-x64': { rust: 'x86_64-apple-darwin', extension: '' },
  'macos-arm64': { rust: 'aarch64-apple-darwin', extension: '' },
}

function rustTarget(target: Target): string {
  if (target === 'windows-x64' && process.env.QUYAN_WINDOWS_RUST_TARGET)
    return process.env.QUYAN_WINDOWS_RUST_TARGET
  return targets[target].rust
}

function version(): string {
  const cargo = readFileSync(path.join(crate, 'Cargo.toml'), 'utf8')
  const match = cargo.match(/^version\s*=\s*"([^"]+)"/m)
  if (!match) throw new Error('Cargo.toml package version is missing')
  return match[1]
}

function targetFromArgs(): Target {
  const requested = process.argv.slice(3).find((arg) => !arg.startsWith('-')) as Target | undefined
  if (requested && requested in targets) return requested
  if (requested)
    throw new Error(`Unsupported target. Choose one of: ${Object.keys(targets).join(', ')}`)
  const platform =
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'macos'
        : process.platform
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined
  const current = arch ? (`${platform}-${arch}` as Target) : undefined
  if (current && current in targets) return current
  throw new Error(`Unsupported current platform: ${process.platform}/${process.arch}`)
}

function runCargo(command: 'build' | 'check' | 'test', target?: Target): void {
  const args = [command, '--manifest-path', path.join(crate, 'Cargo.toml')]
  if (command === 'build') args.push('--release')
  if (target) args.push('--target', rustTarget(target))
  const executable = process.env.QUYAN_CARGO_TOOL || 'cargo'
  execFileSync(executable, args, {
    cwd: root,
    stdio: 'inherit',
  })
}

function packageBinary(target: Target): void {
  runCargo('build', target)
  const native = path.join(
    crate,
    'target',
    rustTarget(target),
    'release',
    `quyan${targets[target].extension}`,
  )
  if (!existsSync(native)) throw new Error(`Rust binary was not created: ${native}`)
  mkdirSync(release, { recursive: true })
  const output = path.join(release, `quyan-v${version()}-${target}${targets[target].extension}`)
  rmSync(output, { force: true })
  rmSync(`${output}.sha256`, { force: true })
  copyFileSync(native, output)
  const digest = createHash('sha256').update(readFileSync(output)).digest('hex')
  writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`)
  const size = statSync(output).size
  if (size > 12 * 1024 * 1024)
    throw new Error(`${target} is ${size} bytes, exceeding the 12MB limit`)
  process.stdout.write(`Created ${output} (${size} bytes)\n`)
}

function check(): void {
  runCargo('check')
  runCargo('test')
}

const action = process.argv[2] || 'package'
if (action === 'check') check()
else if (action === 'build') runCargo('build', process.argv[3] as Target | undefined)
else if (action === 'package') packageBinary(targetFromArgs())
else if (action === 'verify') {
  const expectedVersion = version()
  for (const [target, metadata] of Object.entries(targets) as [
    Target,
    { rust: string; extension: string },
  ][]) {
    const file = path.join(release, `quyan-v${expectedVersion}-${target}${metadata.extension}`)
    if (!existsSync(file)) throw new Error(`Missing release artifact: ${file}`)
    const digest = createHash('sha256').update(readFileSync(file)).digest('hex')
    const checksum = readFileSync(`${file}.sha256`, 'utf8').trim().split(/\s+/)[0]
    if (digest !== checksum) throw new Error(`Checksum mismatch: ${file}`)
    const size = statSync(file).size
    if (size > 12 * 1024 * 1024) throw new Error(`${file} exceeds the 12MB size limit`)
  }
  process.stdout.write(
    `Verified ${Object.keys(targets).length} native CLI artifacts for v${expectedVersion}\n`,
  )
} else throw new Error(`Unknown action: ${action}`)
