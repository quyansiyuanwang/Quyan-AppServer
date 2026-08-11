import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const projectRoot = dirname(dirname(scriptPath))
const frontendRoot = join(projectRoot, 'apps', 'frontend')
const certificateDirectory = join(frontendRoot, '.certs')
const certificatePath = join(certificateDirectory, 'qysyw.test.pem')
const keyPath = join(certificateDirectory, 'qysyw.test-key.pem')
const beginMarker = '# BEGIN APPSERVER LOCAL DOMAINS'
const endMarker = '# END APPSERVER LOCAL DOMAINS'
const localHosts = [
  'www.qysyw.test',
  'auth.qysyw.test',
  'account.qysyw.test',
  'chat.qysyw.test',
  'terminal.qysyw.test',
  'ai.console.qysyw.test',
  'developer.console.qysyw.test',
  'ram.console.qysyw.test',
  'kv.console.qysyw.test',
  'short-link.console.qysyw.test',
  'secret.console.qysyw.test',
  'status.console.qysyw.test',
  'verification.console.qysyw.test',
  'ip-geolocation.console.qysyw.test',
  'push.console.qysyw.test',
  'oj.console.qysyw.test',
  'management.qysyw.test',
  'ai.management.qysyw.test',
  'developer.management.qysyw.test',
  'terminal.management.qysyw.test',
]

const arguments_ = new Set(process.argv.slice(2))
const uninstall = arguments_.has('--uninstall')
const removeCertificates = arguments_.has('--remove-certificates')
const dryRun = arguments_.has('--dry-run')
const writeHostsOnly = arguments_.has('--write-hosts-only')
const elevated = arguments_.has('--elevated')

function getHostsPath() {
  if (process.platform === 'win32') {
    return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  }

  return '/etc/hosts'
}

function removeManagedHostsBlock(content) {
  const expression = new RegExp(
    `^${escapeRegExp(beginMarker)}\\r?\\n[\\s\\S]*?^${escapeRegExp(endMarker)}\\r?\\n?`,
    'gm',
  )
  return content.replace(expression, '')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function updateHosts(addMappings) {
  const hostsPath = getHostsPath()
  const originalContent = await readFile(hostsPath, 'utf8')
  const contentWithoutManagedBlock = removeManagedHostsBlock(originalContent)
  let updatedContent = contentWithoutManagedBlock

  if (addMappings) {
    const endOfLine = originalContent.includes('\r\n') ? '\r\n' : '\n'
    if (updatedContent.length > 0 && !updatedContent.endsWith('\n')) {
      updatedContent += endOfLine
    }
    if (updatedContent.length > 0 && !updatedContent.endsWith(`${endOfLine}${endOfLine}`)) {
      updatedContent += endOfLine
    }

    updatedContent += [beginMarker, `127.0.0.1 ${localHosts.join(' ')}`, endMarker, ''].join(
      endOfLine,
    )
  }

  if (updatedContent === originalContent) {
    console.log('The project hosts mapping is already up to date.')
    return
  }

  if (dryRun) {
    console.log(
      `${addMappings ? 'Would add or update' : 'Would remove'} the AppServer local domains block in ${hostsPath}.`,
    )
    return
  }

  await writeFile(hostsPath, updatedContent, 'utf8')
  flushDnsCache()
  console.log(`${addMappings ? 'Updated' : 'Removed'} the AppServer local domain mappings.`)
}

function flushDnsCache() {
  try {
    if (process.platform === 'win32') {
      execFileSync('ipconfig', ['/flushdns'], { stdio: 'ignore' })
    } else if (process.platform === 'darwin') {
      execFileSync('dscacheutil', ['-flushcache'], { stdio: 'ignore' })
      execFileSync('killall', ['-HUP', 'mDNSResponder'], { stdio: 'ignore' })
    } else if (commandExists('resolvectl')) {
      execFileSync('resolvectl', ['flush-caches'], { stdio: 'ignore' })
    }
  } catch {
    // /etc/hosts changes take effect immediately; cache flushing is best-effort.
  }
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' })
  return result.status === 0 || result.status === 1
}

function warnProxyConfiguration() {
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy
  if (!proxy) return

  const bypass = process.env.NO_PROXY || process.env.no_proxy || ''
  if (bypass.includes('*') || /(^|[,;\s])\.?qysyw\.test([,;\s]|$)/i.test(bypass)) return

  console.warn(
    `A local HTTP(S) proxy is configured (${proxy}), but .qysyw.test is not in NO_PROXY. Add localhost,127.0.0.1,.qysyw.test to your proxy bypass list before opening the local sites.`,
  )
}

function assertMkcertAvailable() {
  if (!commandExists('mkcert')) {
    const installCommand =
      process.platform === 'darwin'
        ? 'brew install mkcert nss'
        : process.platform === 'win32'
          ? 'winget install FiloSottile.mkcert'
          : 'Install mkcert with your distribution package manager, then run this command again.'
    throw new Error(`mkcert was not found. ${installCommand}`)
  }
}

async function generateCertificates() {
  if (dryRun) {
    console.log(
      `Would install the local development CA and generate certificates in ${certificateDirectory}.`,
    )
    return
  }

  assertMkcertAvailable()
  await mkdir(certificateDirectory, { recursive: true })
  execFileSync('mkcert', ['-install'], { stdio: 'inherit' })
  execFileSync('mkcert', ['-key-file', keyPath, '-cert-file', certificatePath, ...localHosts], {
    stdio: 'inherit',
  })
}

async function removeGeneratedCertificates() {
  if (!removeCertificates) return

  for (const path of [keyPath, certificatePath]) {
    if (!existsSync(path)) continue
    if (dryRun) {
      console.log(`Would remove ${path}.`)
      continue
    }
    await rm(path, { force: true })
  }
}

function runElevatedHostsUpdate() {
  const childArguments = [scriptPath, '--write-hosts-only']
  if (uninstall) childArguments.push('--uninstall')

  if (process.platform === 'win32') {
    if (elevated) return false

    const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`
    const command = [
      `$node = ${quotePowerShell(process.execPath)}`,
      `$arguments = @(${childArguments.map(quotePowerShell).join(', ')})`,
      '$process = Start-Process -FilePath $node -ArgumentList $arguments -Verb RunAs -Wait -PassThru',
      'exit $process.ExitCode',
    ].join('; ')
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { stdio: 'inherit' },
    )
    if (result.status !== 0) {
      throw new Error(`The elevated hosts update exited with code ${result.status ?? 'unknown'}.`)
    }
    return true
  }

  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    const result = spawnSync('sudo', [process.execPath, ...childArguments], { stdio: 'inherit' })
    if (result.status !== 0) {
      throw new Error(`The elevated hosts update exited with code ${result.status ?? 'unknown'}.`)
    }
    return true
  }

  return false
}

async function main() {
  if (writeHostsOnly) {
    await updateHosts(!uninstall)
    return
  }

  if (dryRun) {
    await updateHosts(!uninstall)
    if (uninstall) {
      await removeGeneratedCertificates()
      console.log('Dry run completed without changing hosts, certificates, or the trust store.')
    } else {
      await generateCertificates()
      console.log('Dry run completed without changing hosts, certificates, or the trust store.')
    }
    return
  }

  if (!uninstall) {
    assertMkcertAvailable()
    await generateCertificates()
  }

  if (runElevatedHostsUpdate()) {
    if (uninstall) {
      await removeGeneratedCertificates()
    }
    console.log(
      uninstall
        ? 'Local domain teardown completed.'
        : 'Local domains and HTTPS certificate are ready. Start the frontend with pnpm run dev:frontend.',
    )
    warnProxyConfiguration()
    return
  }

  await updateHosts(!uninstall)
  if (uninstall) {
    await removeGeneratedCertificates()
  }
  console.log(
    uninstall
      ? 'Local domain teardown completed.'
      : 'Local domains and HTTPS certificate are ready. Start the frontend with pnpm run dev:frontend.',
  )
  warnProxyConfiguration()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
