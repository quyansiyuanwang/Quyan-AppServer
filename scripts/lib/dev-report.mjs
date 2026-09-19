// Shared PASS/WARN/FAIL reporting for the local development scripts.

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

const color = (text, code) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text)

const labels = {
  pass: color('PASS', '32'),
  warn: color('WARN', '33'),
  fail: color('FAIL', '31'),
  info: color('INFO', '36'),
}

export function createReporter({ title } = {}) {
  const entries = []
  let failures = 0
  let warnings = 0

  if (title) console.log(color(title, '36'))

  const record = (status, message, detail) => {
    entries.push({ status, message, detail })
    if (status === 'fail') failures += 1
    if (status === 'warn') warnings += 1

    console.log(`${labels[status]} ${message}`)
    if (detail) console.log(`     ${detail}`)
    return status
  }

  return {
    pass: (message, detail) => record('pass', message, detail),
    warn: (message, detail) => record('warn', message, detail),
    fail: (message, detail) => record('fail', message, detail),
    info: (message) => console.log(`${labels.info} ${message}`),
    log: (message = '') => console.log(message),
    get failures() {
      return failures
    },
    get warnings() {
      return warnings
    },
    entries,
    summary() {
      if (failures > 0) {
        console.log(color(`\n${failures} 项必需检查失败，${warnings} 项警告。`, '31'))
        return 1
      }
      console.log(color(`\n全部必需检查通过（${warnings} 项警告）。`, '32'))
      return 0
    },
  }
}
