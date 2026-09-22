// Minimal semver range evaluation for the two range forms declared by the
// repository (`^x.y.z || >=x.y.z`). Versions are never duplicated here: callers
// pass the authoritative value read from package.json.

const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export function parseVersion(value) {
  const match = SEMVER_PATTERN.exec(String(value ?? '').trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? '',
  }
}

const compareVersions = (left, right) =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch

function satisfiesComparator(version, comparator) {
  const trimmed = comparator.trim()
  if (!trimmed) return true

  const match = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(trimmed)
  const operator = match?.[1] ?? ''
  const target = parseVersion(match?.[2])
  if (!target) return false

  const difference = compareVersions(version, target)
  switch (operator) {
    case '>':
      return difference > 0
    case '>=':
      return difference >= 0
    case '<':
      return difference < 0
    case '<=':
      return difference <= 0
    case '':
    case '=':
      return difference === 0
    case '^':
      return difference >= 0 && version.major === target.major
    case '~':
      return (
        difference >= 0 && version.major === target.major && version.minor === target.minor
      )
    default:
      return false
  }
}

/** Returns whether `version` satisfies an `||`-separated comparator range. */
export function satisfiesRange(version, range) {
  const parsed = typeof version === 'string' ? parseVersion(version) : version
  if (!parsed) return false

  return String(range ?? '')
    .split('||')
    .map((alternative) => alternative.trim())
    .filter(Boolean)
    .some((alternative) =>
      alternative
        .split(/\s+/)
        .filter(Boolean)
        .every((comparator) => satisfiesComparator(parsed, comparator)),
    )
}

/** Reads `pnpm@10.33.0` style packageManager declarations. */
export function parsePackageManager(value) {
  const match = /^([^@]+)@(.*)$/.exec(String(value ?? '').trim())
  if (!match) return null
  return { name: match[1], version: match[2] }
}
