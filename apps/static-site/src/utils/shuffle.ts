export const shuffle = <T>(items: T[]): T[] => {
  const output = [...items]
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = output[i]
    const target = output[j]
    if (current === undefined || target === undefined) continue
    output[i] = target
    output[j] = current
  }
  return output
}
