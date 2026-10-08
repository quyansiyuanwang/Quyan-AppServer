import { ALL_PERMISSIONS, Permission } from '../permission'
// Preserve distinct legacy permissions; derive the catalog from its sole source.
const overrides: Partial<Record<Permission, string>> = {
  [Permission.RAM_USER_CREATE]: 'quyan:ram:CreateUser',
  [Permission.RAM_USER_READ]: 'quyan:ram:ReadUser',
  [Permission.RAM_USER_UPDATE]: 'quyan:ram:UpdateUser',
  [Permission.RAM_USER_DELETE]: 'quyan:ram:DeleteUser',
  [Permission.RAM_POLICY_CREATE]: 'quyan:ram:CreatePolicy',
  [Permission.RAM_POLICY_READ]: 'quyan:ram:ReadPolicy',
  [Permission.RAM_POLICY_UPDATE]: 'quyan:ram:UpdatePolicy',
  [Permission.RAM_POLICY_DELETE]: 'quyan:ram:DeletePolicy',
  [Permission.RAM_POLICY_ATTACH]: 'quyan:ram:AttachPolicy',
  [Permission.RAM_POLICY_DETACH]: 'quyan:ram:DetachPolicy',
}
export const LEGACY_PERMISSION_ACTIONS: Readonly<Record<Permission, string>> = Object.freeze(
  Object.fromEntries(
    ALL_PERMISSIONS.map((permission) => {
      const parts = permission.split(':')
      const operation = (parts.pop() ?? '')
        .split('_')
        .map((part) => (part.length ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
        .join('')
      return [permission, overrides[permission] ?? ['quyan', ...parts, operation].join(':')]
    }),
  ) as Record<Permission, string>,
)
export function actionForPermission(permission: Permission): string {
  const action = LEGACY_PERMISSION_ACTIONS[permission]
  if (!action) throw new Error('Unmapped legacy permission')
  return action
}
