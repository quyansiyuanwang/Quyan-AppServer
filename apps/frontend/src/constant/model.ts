/**
 * User data model with default values matching UserDto from types.gen.ts
 */
import { ACCOUNT_STATUS } from '@/constant/status'

export const UserInfo = {
  id: '',
  username: '',
  email: null as string | null,
  name: null as string | null,
  status: ACCOUNT_STATUS.DISABLED,
  groupId: '',
  balance: 0,
  createdAt: '',
  updatedAt: '',
}

export type UserInfoType = typeof UserInfo
