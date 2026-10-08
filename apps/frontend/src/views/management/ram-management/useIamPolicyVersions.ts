import { ref } from 'vue'
import type { RamPolicyDto, RamPolicyVersionDto } from '@/client/types.gen'
import { ramService } from '@/service/ramService'
import { ElMessageBox } from '@/utils/elementPlusRuntime'
import { i18ns } from '@/locales'

export function useIamPolicyVersions(options: {
  canUpdate: () => boolean
  onChanged: () => Promise<void>
}) {
  const iamVersionsVisible = ref(false)
  const iamVersionPolicy = ref<RamPolicyDto | null>(null)
  const iamVersions = ref<RamPolicyVersionDto[]>([])
  const iamVersionPage = ref(1)
  const iamVersionPageSize = ref(20)
  const iamVersionTotal = ref(0)
  const iamVersionsLoading = ref(false)
  const iamVersionsFailed = ref(false)
  const iamVersionRestoring = ref(false)
  const iamVersionRestoreFailed = ref(false)
  const iamVersionPreview = ref<RamPolicyVersionDto | null>(null)
  const iamDefaultDocumentHash = ref<string>()
  let requestSequence = 0

  const loadIamPolicyVersions = async () => {
    const policyId = iamVersionPolicy.value?.id
    if (!policyId) return
    const sequence = ++requestSequence
    iamVersionsLoading.value = true
    iamVersionsFailed.value = false
    iamVersionRestoreFailed.value = false
    iamVersions.value = []
    iamVersionTotal.value = 0
    iamVersionPreview.value = null
    iamDefaultDocumentHash.value = undefined
    try {
      const result = await ramService.listPolicyVersions(policyId, {
        page: iamVersionPage.value,
        pageSize: iamVersionPageSize.value,
      })
      if (sequence !== requestSequence) return
      iamVersions.value = result.items
      iamVersionTotal.value = result.total
      iamVersionPage.value = result.page
      iamVersionPageSize.value = result.pageSize
      iamDefaultDocumentHash.value = result.defaultDocumentHash
    } catch {
      if (sequence === requestSequence) iamVersionsFailed.value = true
    } finally {
      if (sequence === requestSequence) iamVersionsLoading.value = false
    }
  }
  const resetIamPolicyVersions = () => {
    requestSequence++
    iamVersionPolicy.value = null
    iamVersions.value = []
    iamVersionTotal.value = 0
    iamVersionPreview.value = null
    iamDefaultDocumentHash.value = undefined
    iamVersionsLoading.value = false
    iamVersionsFailed.value = false
    iamVersionRestoreFailed.value = false
  }
  const openIamPolicyVersions = async (policy: RamPolicyDto) => {
    if (iamVersionRestoring.value) return
    resetIamPolicyVersions()
    iamVersionPage.value = 1
    iamVersionPolicy.value = policy
    iamVersionsVisible.value = true
    await loadIamPolicyVersions()
  }
  const changeIamVersionPage = async (page: number) => {
    if (iamVersionRestoring.value) return
    iamVersionPage.value = page
    await loadIamPolicyVersions()
  }
  const changeIamVersionPageSize = async (pageSize: number) => {
    if (iamVersionRestoring.value) return
    iamVersionPage.value = 1
    iamVersionPageSize.value = pageSize
    await loadIamPolicyVersions()
  }
  const restoreIamPolicyVersion = async (version: RamPolicyVersionDto) => {
    const policy = iamVersionPolicy.value
    const hash = iamDefaultDocumentHash.value
    if (
      iamVersionRestoring.value ||
      iamVersionsLoading.value ||
      !options.canUpdate() ||
      policy?.type !== 'custom' ||
      version.isDefault ||
      !iamVersions.value.some((row) => row.id === version.id)
    )
      return
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
      iamVersionRestoreFailed.value = true
      return
    }
    iamVersionRestoring.value = true
    const sequence = requestSequence
    try {
      try {
        await ElMessageBox.confirm(i18ns.t('RamManagement.iamRestoreConfirm'), i18ns.t('warning'), {
          type: 'warning',
        })
      } catch {
        return
      }
      if (sequence !== requestSequence || !options.canUpdate()) return
      await ramService.setDefaultPolicyVersion(policy.id, {
        versionId: version.id,
        expectedDocumentHash: hash,
      })
      await loadIamPolicyVersions()
      await options.onChanged()
    } catch {
      if (iamVersionPolicy.value?.id === policy.id) {
        iamVersionRestoreFailed.value = true
        // A failed mutation may have raced another writer: require an explicit refresh before retrying.
        iamDefaultDocumentHash.value = undefined
      }
    } finally {
      iamVersionRestoring.value = false
    }
  }
  return {
    iamVersionsVisible,
    iamVersionPolicy,
    iamVersions,
    iamVersionPage,
    iamVersionPageSize,
    iamVersionTotal,
    iamVersionsLoading,
    iamVersionsFailed,
    iamVersionRestoring,
    iamVersionRestoreFailed,
    iamVersionPreview,
    iamDefaultDocumentHash,
    openIamPolicyVersions,
    loadIamPolicyVersions,
    resetIamPolicyVersions,
    changeIamVersionPage,
    changeIamVersionPageSize,
    restoreIamPolicyVersion,
  }
}
