import { access, realpath } from 'node:fs/promises'
import path from 'node:path'

const ROOT_MARKERS = ['pnpm-workspace.yaml', 'package.json'] as const

export async function resolveWorkspaceRoot(
  candidate = process.env.APPSERVER_MCP_ROOT ?? process.cwd(),
): Promise<string> {
  const root = await realpath(candidate)
  await Promise.all(ROOT_MARKERS.map((marker) => access(path.join(root, marker))))
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
