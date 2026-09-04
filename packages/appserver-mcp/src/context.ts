const DOCUMENTS = [
  'AGENTS.md',
  '.agents/skills/appserver-cli-development/SKILL.md',
  'apps/cli-native/README.md',
  'docs/development/15-cli.md',
  'docs/development/01-architecture.md',
  'docs/development/02-backend.md',
  'docs/development/03-frontend.md',
  'docs/development/04-shared-package.md',
  'docs/development/07-authentication.md',
  'docs/development/08-openapi-pipeline.md',
  'docs/development/11-testing-and-ci.md',
  'docs/development/12-git-workflow-and-mcp.md',
] as const

export function getRepositoryContext(domain?: string) {
  const scopes: Record<string, string[]> = {
    backend: [
      'apps/backend/',
      'appserver-backend-development',
      'appserver-contracts',
      'appserver-testing-ci',
    ],
    frontend: [
      'apps/frontend/',
      'appserver-frontend-development',
      'appserver-vue-view-splitting',
      'appserver-contracts',
      'appserver-testing-ci',
    ],
    cli: [
      'apps/cli-native/',
      'appserver-cli-development',
      'appserver-contracts',
      'appserver-testing-ci',
      'appserver-git-workflow',
    ],
    relay: [
      'apps/backend/src/services/relay/',
      'appserver-backend-development',
      'appserver-contracts',
      'appserver-security',
    ],
    git: ['.husky/', 'commitlint.config.js', 'appserver-git-workflow', 'appserver-pr-workflow'],
    security: ['SECURITY.md', 'appserver-security', 'appserver-contracts'],
    testing: [
      'apps/backend/tests/',
      'apps/frontend/tests/',
      'apps/cli-native/src/',
      'appserver-testing-ci',
    ],
    skills: ['.agents/skills/', 'appserver-skill-authoring', 'AGENTS.md'],
  }

  return {
    workspace: 'AppServerMonorepo',
    packageManager: 'pnpm@10.33.0',
    applications: ['@quyan/backend', '@quyan/frontend', '@quyan/docs-site', 'quyan-native'],
    skills: [
      'appserver-backend-development',
      'appserver-frontend-development',
      'appserver-testing-ci',
      'appserver-contracts',
      'appserver-security',
      'appserver-pr-workflow',
      'appserver-git-workflow',
      'appserver-skill-authoring',
      'appserver-vue-view-splitting',
      'appserver-docs-site-development',
      'appserver-cli-development',
    ],
    documents: DOCUMENTS,
    scripts: [
      'pnpm run mcp:serve',
      'pnpm run commit -- -m "type(scope): subject"',
      'pnpm run openapi:gen:all',
      'pnpm run validate:permissions',
    ],
    focus: domain ? (scopes[domain] ?? []) : [],
    invariants: [
      'Controller -> Service -> Repository -> Prisma',
      'packages/shared 是前后端共享契约唯一规范源',
      'Controller/DTO/schema 变更必须生成 OpenAPI',
      '局部变更优先精确测试，数据库测试使用 worker 隔离',
      'src/client 为生成文件，禁止手动编辑',
      'apps/cli-native 使用 Rust 和 Ratatui；OpenAPI client 由 Progenitor 在 build.rs 中生成',
    ],
  }
}
