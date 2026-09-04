import { describe, expect, test } from 'bun:test'
import { suggestProfiles } from '../src/checks.js'
import { assertTestPath, suggestScope } from '../src/git.js'

describe('git impact helpers', () => {
  test('infers precise commit scopes from changed files', () => {
    expect(suggestScope(['apps/backend/src/api/controllers/v1/relay/channels.ts'])).toBe('relay')
    expect(suggestScope(['apps/frontend/src/views/HomeView.vue'])).toBe('frontend')
    expect(suggestScope(['apps/cli-native/src/cli.rs'])).toBe('cli')
    expect(suggestScope(['docs/development/11-testing-and-ci.md'])).toBe('docs')
  })

  test('accepts only exact test paths for the matching application', () => {
    expect(
      assertTestPath('C:/repo', 'apps/backend/tests/unit/utils/foo.unit.test.ts', 'backend'),
    ).toBe('apps/backend/tests/unit/utils/foo.unit.test.ts')
    expect(assertTestPath('C:/repo', 'tests/dom/a.dom.test.ts', 'frontend')).toBe(
      'apps/frontend/tests/dom/a.dom.test.ts',
    )
    expect(() => assertTestPath('C:/repo', 'apps/backend/src/foo.ts', 'backend')).toThrow()
    expect(() =>
      assertTestPath('C:/repo', 'apps/frontend/tests/dom/a.dom.test.ts', 'backend'),
    ).toThrow()
    expect(() =>
      assertTestPath('C:/repo', 'apps/backend/tests/unit/../secret.unit.test.ts', 'backend'),
    ).toThrow()
  })

  test('maps contract and database risks to safe validation profiles', () => {
    const profiles = suggestProfiles(['backend', 'shared'], ['openapi', 'database'])
    expect(profiles.map(({ profile }) => profile)).toEqual(
      expect.arrayContaining([
        'backend-type-check',
        'frontend-type-check',
        'openapi-generate',
        'backend-database',
      ]),
    )
  })

  test('suggests CLI checks for CLI changes', () => {
    expect(suggestProfiles(['cli'], []).map(({ profile }) => profile)).toEqual(
      expect.arrayContaining(['cli-type-check', 'cli-test']),
    )
  })
})
