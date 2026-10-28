export const IAM_AUTHORIZATION_SCOPE_TYPES = ['account', 'resource-group', 'resource'] as const
export type IamAuthorizationScopeType = (typeof IAM_AUTHORIZATION_SCOPE_TYPES)[number]
export const IAM_PRINCIPAL_TYPES = ['user', 'group', 'role'] as const
export type IamAuthorizationPrincipalType = (typeof IAM_PRINCIPAL_TYPES)[number]
export interface IamAuthorizationContract {
  id: string
  accountOwnerId: string
  principalType: IamAuthorizationPrincipalType
  principalId: string
  policyId: string
  scopeType: IamAuthorizationScopeType
  scopeResourceId?: string | null
  scopeArn?: string | null
  description?: string | null
  status: number
  createdBy: string
  createTime: string
  updateTime: string
}
export interface IamResourceGroupMemberContract {
  id: string
  resourceGroupId: string
  resourceArn: string
  service: string
  resourceType: string
  resourceId: string
  status: number
  createTime: string
  updateTime: string
}
export interface IamResourceGroupContract {
  id: string
  accountOwnerId: string
  name: string
  description?: string | null
  status: number
  createTime: string
  updateTime: string
  members: IamResourceGroupMemberContract[]
}

/** Bounded candidate pages: IAM filtering can yield an empty page with hasNext=true. */
export const IAM_MANAGEMENT_PAGINATION = Object.freeze({
  defaultPageSize: 50,
  maxPageSize: 100,
  maxPage: 10000,
})
export interface IamManagementPageResult<T> {
  items: T[]
  page: number
  pageSize: number
  hasNext: boolean
}
export type IamResourceGroupSummary = Omit<IamResourceGroupContract, 'members'>
