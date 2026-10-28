import { describe, expect, it, vi } from 'vitest'
import {
  buildIamAuthorizationRequests,
  iamAuthorizationPolicyHighRisk,
  IAM_AUTHORIZATION_SELECTION_LIMITS,
} from '@/views/management/ram-management/iam-authorization-selection'
import { useIamAuthorizationBatch } from '@/views/management/ram-management/useIamAuthorizationBatch'
import { Permission } from '@quyan/shared'
describe('IAM authorization selection safety', () => {
  it('builds every principal-policy pair with exactly the selected scope', () => {
    const requests = buildIamAuthorizationRequests(
      {
        principalType: 'group',
        scopeType: 'resource-group',
        scopeResourceId: 'resources',
        scopeArn: 'ignored',
      },
      ['one', 'two', 'one'],
      ['a', 'b'],
    )
    expect(requests).toEqual([
      {
        principalType: 'group',
        principalId: 'one',
        policyId: 'a',
        scopeType: 'resource-group',
        scopeResourceId: 'resources',
      },
      {
        principalType: 'group',
        principalId: 'one',
        policyId: 'b',
        scopeType: 'resource-group',
        scopeResourceId: 'resources',
      },
      {
        principalType: 'group',
        principalId: 'two',
        policyId: 'a',
        scopeType: 'resource-group',
        scopeResourceId: 'resources',
      },
      {
        principalType: 'group',
        principalId: 'two',
        policyId: 'b',
        scopeType: 'resource-group',
        scopeResourceId: 'resources',
      },
    ])
  })
  it('rejects incomplete scopes and oversized products before sending writes', () => {
    expect(() =>
      buildIamAuthorizationRequests(
        { principalType: 'user', scopeType: 'resource-group' },
        ['user'],
        ['policy'],
      ),
    ).toThrow()
    expect(() =>
      buildIamAuthorizationRequests(
        { principalType: 'user', scopeType: 'resource', scopeArn: ' ' },
        ['user'],
        ['policy'],
      ),
    ).toThrow()
    expect(() =>
      buildIamAuthorizationRequests(
        { principalType: 'user', scopeType: 'account' },
        Array.from({ length: IAM_AUTHORIZATION_SELECTION_LIMITS.requests + 1 }, (_, index) =>
          String(index),
        ),
        ['policy'],
      ),
    ).toThrow()
  })
  it('warns for IAM administration and broad Allow without treating Deny or resource reads as grants', () => {
    const policy = (Action: string, Effect: 'Allow' | 'Deny' = 'Allow') => ({
      permissions: [],
      document: { Version: '1' as const, Statement: { Effect, Action, Resource: '*' } },
    })
    expect(iamAuthorizationPolicyHighRisk(policy('quyan:ram:CreatePolicy'))).toBe(true)
    expect(iamAuthorizationPolicyHighRisk(policy('quyan:ram:*'))).toBe(true)
    expect(iamAuthorizationPolicyHighRisk(policy('*', 'Deny'))).toBe(false)
    expect(iamAuthorizationPolicyHighRisk(policy('quyan:ram:ReadUser'))).toBe(false)
    expect(iamAuthorizationPolicyHighRisk({ permissions: [Permission.RAM_POLICY_ATTACH] })).toBe(
      true,
    )
  })
  it('stops on failure and retries only remaining immutable requests', async () => {
    const requests = buildIamAuthorizationRequests(
      { principalType: 'user', scopeType: 'resource', scopeArn: 'acs:quyan:*:account:user/target' },
      ['one', 'two'],
      ['policy'],
    )
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'first' })
      .mockRejectedValueOnce(Error('fixture denied'))
      .mockResolvedValue({ id: 'second' })
    const batch = useIamAuthorizationBatch(create)
    await expect(batch.run(requests)).rejects.toThrow('fixture denied')
    expect(batch.completed.value).toBe(1)
    expect(batch.pending.value).toEqual([requests[1]])
    requests[1].scopeArn = 'client changed input'
    expect(await batch.run()).toBe(true)
    expect(create.mock.calls.map(([request]) => request.principalId)).toEqual(['one', 'two', 'two'])
    expect(create.mock.calls[2][0].scopeArn).toBe('acs:quyan:*:account:user/target')
    expect(batch.completed.value).toBe(2)
    expect(batch.pending.value).toBeUndefined()
  })
  it('sends no further writes after disposal and ignores a second click during submission', async () => {
    let finish!: () => void
    const create = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const batch = useIamAuthorizationBatch(create)
    const requests = buildIamAuthorizationRequests(
      { principalType: 'user', scopeType: 'account' },
      ['one', 'two'],
      ['policy'],
    )
    const active = batch.run(requests)
    expect(await batch.run(requests)).toBe(false)
    batch.dispose()
    finish()
    expect(await active).toBe(false)
    expect(create).toHaveBeenCalledTimes(1)
  })
})
