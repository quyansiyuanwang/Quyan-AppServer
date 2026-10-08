import { describe, expect, it } from 'vitest'
import {
  exportVisualPolicy,
  importVisualPolicy,
  newVisualStatement,
  visualConditionKeys,
  visualResourceTemplate,
  visualResourceTypes,
} from '@/views/management/ram-management/iam-visual-policy'
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
    expect(visualConditionKeys(['quyan:ram:ReadUser']).map((key) => key.key)).not.toContain(
      'quyan:ResourceGroupId',
    )
    expect(visualConditionKeys(['unknown:Action'])).toEqual([])
    const row = importVisualPolicy(document)[0]!
    row.conditions = [
      { key: 'quyan:ResourceGroupId', operator: 'StringEquals', valuesText: '"group"' },
    ]
    expect(() => exportVisualPolicy([row])).toThrow()
    row.actions = ['alidns:AddDomainRecord']
    expect(() => exportVisualPolicy([row])).toThrow()
  })
  it('builds registered templates using the explicit account context and blocks path/account injection', () => {
    expect(visualResourceTemplate('quyan/user', 'owner', 'first')).toBe(
      'acs:quyan:*:owner:user/first',
    )
    expect(visualResourceTemplate('quyan/policy-version', 'owner', 'version', 'policy')).toBe(
      'acs:quyan:*:owner:policy-version/policy/version',
    )
    expect(visualResourceTemplate('quyan/user', 'owner', '*')).toBe('acs:quyan:*:owner:user/*')
    expect(visualResourceTemplate('quyan/account', 'owner', '')).toBe('acs:quyan:*:owner:account')
    for (const account of ['', '*', 'foreign:account'])
      expect(visualResourceTemplate('quyan/user', account, 'user')).toBeUndefined()
    for (const id of ['', '../user', 'user/account', 'user:foreign'])
      expect(visualResourceTemplate('quyan/user', 'owner', id)).toBeUndefined()
    expect(visualResourceTemplate('alidns/domain', 'owner', 'example.test')).toBeUndefined()
  })
})
