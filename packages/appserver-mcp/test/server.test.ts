import { describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { getRepositoryContext } from '../src/context.js'
import { createMcpServer } from '../src/server.js'

describe('MCP server', () => {
  test('returns a compact repository context with core scripts', () => {
    const context = getRepositoryContext('skills')
    expect(context.workspace).toBe('AppServerMonorepo')
    expect(context.focus).toContain('appserver-skill-authoring')
    expect(context.skills).toContain('appserver-skill-authoring')
    expect(context.applications).toContain('quyan-native')
    expect(context.documents).toContain('apps/cli-native/README.md')
    expect(context.scripts).toContain('pnpm run mcp:serve')
  })

  test('lists the six constrained tools', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer(process.cwd())
    const client = new Client({ name: 'quyan-mcp-test', version: '1.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    const response = await client.listTools()
    expect(response.tools.map((tool) => tool.name).sort()).toEqual([
      'draft_commit_message',
      'git_impact',
      'read_file',
      'repo_context',
      'run_check',
      'suggest_validation',
    ])
    await client.close()
    await server.close()
  })
})
