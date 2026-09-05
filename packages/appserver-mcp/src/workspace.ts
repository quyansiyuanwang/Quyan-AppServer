import { access, realpath } from 'node:fs/promises'
import path from 'node:path'

const ROOT_MARKERS = ['pnpm-workspace.yaml', 'package.json'] as const

async function isWorkspaceRoot(candidate: string): Promise<boolean> {
  try {
    await Promise.all(ROOT_MARKERS.map((marker) => access(path.join(candidate, marker))))
    return true
  } catch {
    return false
  }
}

export async function resolveWorkspaceRoot(
  candidate = process.env.QUYAN_MCP_ROOT ?? process.cwd(),
): Promise<string> {
  let root = await realpath(candidate)

  while (!(await isWorkspaceRoot(root))) {
    const parent = path.dirname(root)
    if (parent === root) {
      throw new Error(`无法从 \`${candidate}\` 找到 pnpm workspace 根目录`)
    }
    root = parent
  }

  return root
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  )
}

export function toPosixPath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/')
}
