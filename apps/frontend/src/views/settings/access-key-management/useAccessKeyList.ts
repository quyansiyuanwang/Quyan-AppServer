import { AccessKeyService } from '@/service/accesskeyService'
import type { AccessKeyDto } from '@/client/types.gen'
import { useIamManagementPage } from '@/views/management/ram-management/useIamManagementPage'

/** Reuse candidate-page navigation and stale-response protection; never fetch all keys for local slicing. */
export function useAccessKeyList() {
  const service = AccessKeyService.getInstance()
  return useIamManagementPage<AccessKeyDto>((query) => service.getAccessKeysPage(query))
}
