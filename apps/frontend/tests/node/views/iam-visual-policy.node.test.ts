import { describe, expect, it } from 'vitest'
import {
  exportVisualPolicy,
  importVisualPolicy,
  newVisualStatement,
  visualConditionKeys,
  visualActionGroups,
  visualActionDependencies,
  visualServiceActionPattern,
  visualResourceTemplate,
  visualResourceIdentifierFields,
  visualResourceAccountId,
  visualResourceTypes,
} from '@/views/management/ram-management/iam-visual-policy'
import {
  IAM_RESOURCE_TYPE_CATALOG,
  IAM_ACTION_DEFINITIONS,
  iamServiceDefinitions,
  matchIamPattern,
} from '@quyan/shared'
import type { IamPolicyDocument } from '@quyan/shared'
const document: IamPolicyDocument = {
  Version: '1',
  Statement: [
    {
      Sid: 'SpecificUser',
      Effect: 'Allow',
      Action: ['quyan:ram:ReadUser', 'quyan:ram:UpdateUser'],
      Resource: ['acs:quyan:*:owner:user/first'],
      Condition: {
        StringEquals: {
          'quyan:PrincipalAccount': ['owner'],
          'acs:UserAgent': ' value with spaces ',
        },
        Bool: { 'acs:SecureTransport': true },
        NumericLessThan: { 'quyan:EpochTime': 1000 },
      },
    },
    { Effect: 'Deny', Action: 'quyan:ram:DeleteUser', Resource: 'acs:quyan:*:owner:user/*' },
  ],
}
describe('IAM visual policy round trip', () => {
  it('retains Deny, specific resources, wildcard patterns and typed condition values', () => {
    const result = exportVisualPolicy(importVisualPolicy(document))
    const statements = Array.isArray(result.Statement) ? result.Statement : [result.Statement]
    expect(statements[0]?.Condition).toEqual(
      (document.Statement as Array<{ Condition: unknown }>)[0]?.Condition,
    )
    expect(statements[0]?.Sid).toBe('SpecificUser')
    expect(statements[0]?.Resource).toEqual(['acs:quyan:*:owner:user/first'])
    expect(statements[1]).toMatchObject({
      Effect: 'Deny',
      Action: ['quyan:ram:DeleteUser'],
      Resource: ['acs:quyan:*:owner:user/*'],
    })
  })
  it('rejects unsupported fields instead of silently removing them', () => {
    expect(() => importVisualPolicy({ ...document, Condition: {} } as IamPolicyDocument)).toThrow()
    expect(() =>
      importVisualPolicy({
        Version: '1',
        Statement: { Effect: 'Allow', Action: '*', Resource: '*', Principal: { RAM: '*' } },
      } as IamPolicyDocument),
    ).toThrow()
    expect(() =>
      importVisualPolicy({
        Version: '1',
        Statement: { Effect: 'Allow', NotAction: 'quyan:ram:DeleteUser', Resource: '*' },
      } as unknown as IamPolicyDocument),
    ).toThrow()
  })
  it('imports a diagnosed exact snapshot while refusing an unvalidated complement', () => {
    const raw: IamPolicyDocument = {
      Version: '1',
      Statement: {
        Effect: 'Allow',
        NotAction: 'quyan:ram:DeleteUser',
        Resource: 'acs:quyan:*:owner:user/first',
      },
    }
    expect(() => importVisualPolicy(raw)).toThrow()
    const snapshot: IamPolicyDocument = {
      Version: '1',
      Statement: {
        Effect: 'Allow',
        Action: ['quyan:ram:ReadUser', 'quyan:ram:UpdateUser'],
        Resource: 'acs:quyan:*:owner:user/first',
      },
    }
    expect(exportVisualPolicy(importVisualPolicy(snapshot))).toEqual({
      Version: '1',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['quyan:ram:ReadUser', 'quyan:ram:UpdateUser'],
          Resource: ['acs:quyan:*:owner:user/first'],
        },
      ],
    })
  })
  it('refuses incomplete statements, duplicate conditions, objects and malformed JSON values', () => {
    expect(() => exportVisualPolicy([newVisualStatement()])).toThrow()
    expect(() => exportVisualPolicy([])).toThrow()
    const row = importVisualPolicy(document)[0]!
    row.conditions = [
      { key: 'quyan:PrincipalAccount', operator: 'StringEquals', valuesText: '"owner"' },
      { key: 'quyan:PrincipalAccount', operator: 'StringEquals', valuesText: '"other"' },
    ]
    expect(() => exportVisualPolicy([row])).toThrow()
    for (const text of ['{', '{}', '[]', 'null', '["owner", {}]']) {
      row.conditions = [
        { key: 'quyan:PrincipalAccount', operator: 'StringEquals', valuesText: text },
      ]
      expect(() => exportVisualPolicy([row])).toThrow()
    }
  })
  it('derives resource and condition options from matched actions and excludes unsupported providers', () => {
    expect(visualResourceTypes(['quyan:ram:ReadUser']).map((type) => type.id)).toEqual([
      'quyan/account',
      'quyan/user',
    ])
    expect(visualConditionKeys(['quyan:ram:ReadUser']).map((key) => key.key)).toContain(
      'acs:SourceIp',
    )
    expect(visualConditionKeys(['quyan:ram:ReadUser']).map((key) => key.key)).toContain(
      'quyan:ResourceGroupId',
    )
    expect(visualConditionKeys(['quyan:ram:ReadUser']).map((key) => key.key)).not.toContain(
      'acs:MFAPresent',
    )
    expect(visualConditionKeys(['unknown:Action'])).toEqual([])
    const row = importVisualPolicy(document)[0]!
    row.conditions = [
      { key: 'quyan:ResourceGroupId', operator: 'StringEquals', valuesText: '"group"' },
    ]
    expect(exportVisualPolicy([row]).Statement).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Condition: { StringEquals: { 'quyan:ResourceGroupId': 'group' } },
        }),
      ]),
    )
    row.conditions = [{ key: 'acs:MFAPresent', operator: 'Bool', valuesText: 'true' }]
    expect(() => exportVisualPolicy([row])).toThrow()
    row.actions = ['alidns:AddDomainRecord']
    expect(() => exportVisualPolicy([row])).toThrow()
  })
  it('builds registered templates using the explicit account context and blocks path/account injection', () => {
    expect(visualResourceTemplate('quyan/user', 'owner', { resourceId: 'first' })).toBe(
      'acs:quyan:*:owner:user/first',
    )
    expect(
      visualResourceTemplate('quyan/policy-version', 'owner', {
        resourceId: 'version',
        parentId: 'policy',
      }),
    ).toBe('acs:quyan:*:owner:policy-version/policy/version')
    expect(visualResourceTemplate('quyan/user', 'owner', { resourceId: '*' })).toBe(
      'acs:quyan:*:owner:user/*',
    )
    expect(visualResourceTemplate('quyan/account', 'owner', {})).toBe('acs:quyan:*:owner:account')
    for (const account of ['', '*', 'foreign:account'])
      expect(visualResourceTemplate('quyan/user', account, { resourceId: 'user' })).toBeUndefined()
    for (const id of ['', '../user', 'user/account', 'user:foreign'])
      expect(visualResourceTemplate('quyan/user', 'owner', { resourceId: id })).toBeUndefined()
    expect(
      visualResourceTemplate('alidns/domain', 'owner', { resourceId: 'example.test' }),
    ).toBeUndefined()
  })
})

describe('registered resource builders', () => {
  it('builds platform probe resources from their channel and resource identifiers', () => {
    for (const type of [
      'platform/relay-probe-profile',
      'platform/relay-probe-run',
      'platform/relay-probe-queue-slot',
    ]) {
      expect(visualResourceIdentifierFields(type)).toEqual(['channelId', 'resourceId'])
      expect(
        visualResourceTemplate(type, 'owner', { channelId: 'channel', resourceId: 'record' }),
      ).toBe(`acs:platform:*:platform:${type.split('/')[1]}/channel/record`)
      expect(
        visualResourceTemplate(type, 'owner', { channelId: '../foreign', resourceId: 'record' }),
      ).toBeUndefined()
      expect(
        visualResourceTemplate(type, 'owner', {
          channelId: 'channel',
          resourceId: 'record',
          accountId: 'foreign',
        }),
      ).toBeUndefined()
    }
  })

  it('derives and resolves every production ARN template without a parallel identifier map', () => {
    for (const type of IAM_RESOURCE_TYPE_CATALOG) {
      const fields = visualResourceIdentifierFields(type.id)
      const identifiers = Object.fromEntries(fields.map((field) => [field, 'id']))
      const result = visualResourceTemplate(type.id, 'owner', identifiers)
      expect(result, type.id).toBeDefined()
      expect(result, type.id).not.toContain('{')
      expect(result?.split(':')[3], type.id).toBe(
        type.accountScope === 'platform' ? 'platform' : 'owner',
      )
    }
  })
  it('supports explicit user/pass identifiers and all three ancestor levels', () => {
    expect(visualResourceIdentifierFields('platform/relay-token')).toEqual(['userId', 'resourceId'])
    expect(
      visualResourceTemplate('platform/relay-token', 'owner', { userId: 'user', resourceId: '*' }),
    ).toBe('acs:platform:*:platform:relay-token/user/*')
    expect(visualResourceIdentifierFields('monthly-pass/usage')).toEqual([
      'ancestorId',
      'parentId',
      'resourceId',
    ])
    expect(
      visualResourceTemplate('monthly-pass/usage', 'owner', {
        ancestorId: 'user',
        parentId: 'pass',
        resourceId: 'usage',
      }),
    ).toBe('acs:monthly-pass:*:owner:usage/user/pass/usage')
  })
  it('rejects missing fields account/path injection and unknown overrides', () => {
    expect(
      visualResourceTemplate('monthly-pass/usage', 'owner', {
        parentId: 'pass',
        resourceId: 'usage',
      }),
    ).toBeUndefined()
    expect(
      visualResourceTemplate('platform/relay-token', 'owner', {
        userId: '*',
        resourceId: 'token',
        accountId: 'foreign',
      }),
    ).toBeUndefined()
    for (const value of ['', '../user', 'foreign:user', 'user/id', '?', '\n', 'a'.repeat(129)])
      expect(
        visualResourceTemplate('platform/relay-token', 'owner', {
          userId: value,
          resourceId: 'token',
        }),
      ).toBeUndefined()
    expect(
      visualResourceTemplate('quyan/user', 'owner', Object.create({ resourceId: 'inherited' })),
    ).toBeUndefined()
    expect(visualResourceAccountId('platform/relay-token', '')).toBeUndefined()
    expect(visualResourceAccountId('platform/relay-token', 'owner')).toBe('platform')
    expect(visualResourceAccountId('relay/provider', 'owner')).toBe('owner')
  })
  it('preserves multiple wildcard segments and never supplies an implicit wildcard', () => {
    expect(
      visualResourceTemplate('monthly-pass/usage', 'owner', {
        ancestorId: '*',
        parentId: 'pass*',
        resourceId: '*id*',
      }),
    ).toBe('acs:monthly-pass:*:owner:usage/*/pass*/*id*')
    expect(
      visualResourceTemplate('relay/provider', 'owner', { parentId: 'user', resourceId: '' }),
    ).toBeUndefined()
  })
})

describe('catalog-driven operation selection', () => {
  it('groups by declared Read Write and List levels with exact per-service membership', () => {
    for (const service of iamServiceDefinitions()) {
      const groups = visualActionGroups(service.code),
        actions = groups.flatMap((group) => group.actions)
      expect(new Set(actions.map((action) => action.action))).toEqual(
        new Set(service.actions.map((action) => action.action)),
      )
      for (const group of groups)
        expect(
          group.actions.every(
            (action) => action.service === service.code && action.accessLevel === group.level,
          ),
        ).toBe(true)
    }
  })
  it('filters categories without turning Read into a Write grant', () => {
    const groups = visualActionGroups('relay', 'Read')
    expect(groups).toHaveLength(1)
    expect(groups[0]?.level).toBe('Read')
    expect(groups[0]?.actions.every((action) => action.accessLevel === 'Read')).toBe(true)
    expect(visualActionGroups('alidns')).toEqual([])
  })
  it('offers only catalog-proven service wildcard scopes', () => {
    expect(visualServiceActionPattern('relay')).toBe('quyan:relay:*')
    expect(visualServiceActionPattern('')).toBeUndefined()
    expect(visualServiceActionPattern('alidns')).toBeUndefined()
    for (const service of iamServiceDefinitions()) {
      const pattern = visualServiceActionPattern(service.code)
      if (!pattern) continue
      const matched = IAM_ACTION_DEFINITIONS.filter((action) =>
        matchIamPattern(pattern, action.action),
      )
      expect(matched.length).toBe(service.actions.length)
      expect(matched.every((action) => action.service === service.code)).toBe(true)
    }
  })
})

describe('semantic submission resource identifiers', () => {
  it.each([
    [
      'relay/channel-change-request',
      { submitterUserId: 'submitter', requestId: 'request' },
      'channel-change-request/submitter/request',
    ],
    [
      'relay/channel-submission',
      { submitterUserId: 'submitter', channelId: 'channel' },
      'channel-submission/submitter/channel',
    ],
    [
      'relay/submission-provider',
      { submitterUserId: 'submitter', channelId: 'channel', providerUserId: 'recipient' },
      'submission-provider/submitter/channel/recipient',
    ],
  ] as const)('keeps identity roles distinct for %s', (type, identifiers, path) => {
    expect(visualResourceIdentifierFields(type)).toEqual(Object.keys(identifiers))
    expect(visualResourceTemplate(type, 'owner', identifiers)).toBe('acs:relay:*:owner:' + path)
    expect(
      visualResourceTemplate(type, 'owner', { parentId: 'submitter', resourceId: 'channel' }),
    ).toBeUndefined()
  })
  it('requires every explicit value and preserves only a deliberately chosen wildcard', () => {
    expect(
      visualResourceTemplate('relay/submission-provider', 'owner', {
        submitterUserId: 'submitter',
        channelId: '*',
        providerUserId: 'recipient',
      }),
    ).toBe('acs:relay:*:owner:submission-provider/submitter/*/recipient')
    expect(
      visualResourceTemplate('relay/submission-provider', 'owner', {
        submitterUserId: 'submitter',
        channelId: 'channel',
      }),
    ).toBeUndefined()
    expect(
      visualResourceTemplate('relay/submission-provider', 'owner', {
        submitterUserId: 'submitter',
        channelId: 'channel',
        providerUserId: 'recipient',
        accountId: 'foreign',
      }),
    ).toBeUndefined()
  })
})

describe('catalog authorization dependency guidance', () => {
  it('keeps generated destinations separate from source scope without changing selected policy content', () => {
    const row = {
      ...newVisualStatement(),
      actions: ['quyan:relay:DuplicateChannels'],
      resourcesText: 'acs:platform:*:platform:relay-channel/exact-source',
    }
    const before = exportVisualPolicy([row])
    const dependencies = visualActionDependencies(row.actions)
    expect(dependencies).toEqual([
      {
        action: row.actions[0],
        dependencyAction: 'quyan:relay:CreateChannelCopy',
        scope: 'cross-resource',
        resourceTypes: ['platform/relay-channel'],
        resourceRole: 'destination',
        selection: 'server-reserved',
      },
    ])
    dependencies[0]!.resourceTypes.length = 0
    expect(visualActionDependencies(row.actions)[0]!.resourceTypes).toEqual([
      'platform/relay-channel',
    ])
    expect(exportVisualPolicy([row])).toEqual(before)
    expect(row.actions).toEqual(['quyan:relay:DuplicateChannels'])
    expect(row.resourcesText).toBe('acs:platform:*:platform:relay-channel/exact-source')
  })
  it('describes the reciprocal source check without recursively expanding grants', () => {
    expect(visualActionDependencies(['quyan:relay:CreateChannelCopy'])).toEqual([
      {
        action: 'quyan:relay:CreateChannelCopy',
        dependencyAction: 'quyan:relay:DuplicateChannels',
        scope: 'cross-resource',
        resourceTypes: ['platform/relay-channel'],
        resourceRole: 'source',
        selection: 'server-resolved',
      },
    ])
  })
  it('deduplicates overlapping action patterns and returns no dependencies for unknown actions', () => {
    expect(
      visualActionDependencies([
        'quyan:relay:DuplicateChannels',
        'quyan:relay:DuplicateChannel*',
        'quyan:relay:DuplicateChannels',
      ]),
    ).toHaveLength(1)
    expect(visualActionDependencies(['alidns:*', 'unknown:*'])).toEqual([])
  })
  it('distinguishes same-resource mandatory and variant-only dependencies', () => {
    expect(
      visualActionDependencies(['quyan:system:error_report:UpdateErrorGroupStatus']),
    ).toContainEqual(
      expect.objectContaining({
        dependencyAction: 'quyan:system:error_report:GetErrorGroup',
        scope: 'same-resource',
      }),
    )
    expect(visualActionDependencies(['quyan:remote_terminal:UpdateEntitlement'])).toContainEqual(
      expect.objectContaining({
        dependencyAction: 'quyan:remote_terminal:DeleteEntitlement',
        scope: 'conditional',
      }),
    )
  })
})
