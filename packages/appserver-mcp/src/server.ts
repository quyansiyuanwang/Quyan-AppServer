import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CHECK_PROFILES, isCheckProfile, runCheck, suggestProfiles } from './checks.js'
import { getRepositoryContext } from './context.js'
import { getGitImpact, suggestScope } from './git.js'
import { readAllowedFile } from './path-policy.js'
import { CHANGE_MODES, COMMIT_TYPES, type ChangeMode, type CommitType } from './types.js'

function result(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : '未知 MCP 错误'
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  }
}

function validateCommitSubject(summary: string): string {
  const normalized = summary.trim()
  if (
    !normalized ||
    normalized.length > 72 ||
    normalized.endsWith('.') ||
    normalized !== normalized.toLowerCase() ||
    !/^[a-z][a-z0-9 -]*$/.test(normalized)
  ) {
    throw new Error('提交 subject 必须是 72 字符以内、不带句号的英文小写短语')
  }
  return normalized
}

function validateScope(scope: string | undefined): string | undefined {
  if (!scope) return undefined
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scope)) {
    throw new Error('scope 必须是小写 kebab-case')
  }
  return scope
}

export function createMcpServer(root: string): McpServer {
  const server = new McpServer({
    name: 'appserver-mcp',
    version: '1.0.0',
  })

  server.registerTool(
    'repo_context',
    {
      title: '仓库上下文摘要',
      description: '返回紧凑的仓库结构、核心约束、技能与文档索引。',
      inputSchema: {
        domain: z
          .enum(['backend', 'frontend', 'relay', 'git', 'security', 'testing', 'skills'])
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ domain }) => result(getRepositoryContext(domain)),
  )

  server.registerTool(
    'git_impact',
    {
      title: 'Git 改动影响面',
      description: '按工作区、暂存区或安全 ref range 返回改动文件、风险和建议 skill。',
      inputSchema: {
        mode: z.enum(CHANGE_MODES).default('working-tree'),
        refRange: z.string().max(160).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ mode, refRange }) => {
      try {
        return result(await getGitImpact(root, mode as ChangeMode, refRange))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'suggest_validation',
    {
      title: '验证建议',
      description: '根据 Git 改动生成确定性的白名单验证 profile，不执行命令。',
      inputSchema: {
        mode: z.enum(CHANGE_MODES).default('working-tree'),
        refRange: z.string().max(160).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ mode, refRange }) => {
      try {
        const impact = await getGitImpact(root, mode as ChangeMode, refRange)
        return result({
          mode: impact.mode,
          profiles: suggestProfiles(impact.domains, impact.risks),
          infrastructure: impact.risks.includes('database') ? ['MySQL', 'Redis（按测试依赖）'] : [],
        })
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'draft_commit_message',
    {
      title: '提交信息草稿',
      description: '根据短英文变更摘要与当前 Git 改动生成并校验 Conventional Commit 信息。',
      inputSchema: {
        type: z.enum(COMMIT_TYPES),
        summary: z.string().min(3).max(72),
        scope: z.string().max(48).optional(),
        mode: z.enum(['working-tree', 'staged']).default('staged'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ type, summary, scope, mode }) => {
      try {
        const impact = await getGitImpact(root, mode as ChangeMode)
        const safeSubject = validateCommitSubject(summary)
        const safeScope = validateScope(scope) ?? suggestScope(impact.files)
        const message =
          String(type as CommitType) + (safeScope ? '(' + safeScope + ')' : '') + ': ' + safeSubject
        if (message.length > 100) throw new Error('提交 header 超过 100 字符')
        return result({
          message,
          scope: safeScope ?? null,
          stagedFiles: impact.files.length,
          warning:
            mode === 'staged' && impact.files.length === 0
              ? '暂存区为空，请先确认 git add 范围。'
              : null,
        })
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'read_file',
    {
      title: '受限文件读取',
      description: '读取受仓库边界、敏感路径、行数和字节数限制的文本文件。',
      inputSchema: {
        path: z.string().min(1).max(300),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (request) => {
      try {
        return result(await readAllowedFile(root, request))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    'run_check',
    {
      title: '执行白名单验证',
      description:
        '只执行固定 validation profile；不接受 shell 命令、额外参数、迁移、部署或 Git 写操作。',
      inputSchema: {
        profile: z.enum(CHECK_PROFILES),
        target: z.string().max(300).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ profile, target }) => {
      try {
        if (!isCheckProfile(profile)) throw new Error('未知验证 profile')
        const command = await runCheck(root, profile, target)
        return result({
          profile,
          exitCode: command.exitCode,
          durationMs: command.durationMs,
          timedOut: command.timedOut,
          stdout: command.stdout,
          stderr: command.stderr,
          stdoutTruncated: command.stdoutTruncated,
          stderrTruncated: command.stderrTruncated,
        })
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  return server
}
