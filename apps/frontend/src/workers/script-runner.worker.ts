self.onmessage = async (e: MessageEvent<{ code: string }>) => {
  const logs: string[] = []
  const origLog = console.log
  const origError = console.error
  const origWarn = console.warn

  function serialize(arg: unknown): string {
    if (typeof arg === 'string') return arg
    if (arg === null) return 'null'
    if (arg === undefined) return 'undefined'
    try {
      return JSON.stringify(arg, null, 2)
    } catch {
      return String(arg)
    }
  }

  console.log = (...args: unknown[]) => {
    const text = args.map(serialize).join(' ')
    logs.push(text)
    self.postMessage({ type: 'log', text })
  }
  console.error = (...args: unknown[]) => {
    const text = '[error] ' + args.map(serialize).join(' ')
    logs.push(text)
    self.postMessage({ type: 'log', text })
  }
  console.warn = (...args: unknown[]) => {
    const text = '[warn] ' + args.map(serialize).join(' ')
    logs.push(text)
    self.postMessage({ type: 'log', text })
  }

  // Track all pending promise chains so we wait for .then() callbacks too,
  // not just top-level awaits inside the user's async IIFE.

  const origThen = Promise.prototype.then as any
  const pending = new Set<Promise<unknown>>()
  let intercepting = false

  function trackPromise(p: Promise<unknown>) {
    pending.add(p)
    origThen.call(
      p,
      () => pending.delete(p),
      () => pending.delete(p),
    )
  }

  ;(Promise.prototype as any).then = function (onFulfilled: any, onRejected: any) {
    const result = origThen.call(this, onFulfilled, onRejected)
    if (intercepting) trackPromise(result)
    return result
  }

  let hadError = false
  try {
    intercepting = true
    await new Function(`return (async () => { ${e.data.code} })()`)()

    // Drain all pending .then() chains created during user code execution
    while (pending.size > 0) {
      intercepting = false
      await Promise.allSettled([...pending])
      intercepting = true
    }
  } catch (err: unknown) {
    hadError = true
    const text = '[exception] ' + (err instanceof Error ? err.message : String(err))
    self.postMessage({ type: 'log', text })
    logs.push(text)
  } finally {
    intercepting = false
    Promise.prototype.then = origThen
    console.log = origLog
    console.error = origError
    console.warn = origWarn
    self.postMessage({ type: 'done', logs, hasError: hadError })
  }
}
