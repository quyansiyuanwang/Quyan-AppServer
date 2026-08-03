import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './server.js'
import { resolveWorkspaceRoot } from './workspace.js'

async function main() {
  const root = await resolveWorkspaceRoot()
  const server = createMcpServer(root)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[appserver-mcp] 已启动，仓库根目录：' + root)
}

main().catch((error: unknown) => {
  console.error('[appserver-mcp] 启动失败：', error)
  process.exitCode = 1
})
