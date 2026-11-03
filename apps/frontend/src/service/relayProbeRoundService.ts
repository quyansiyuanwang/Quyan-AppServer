import { useRequestStore } from '@/stores/request'
import { cacheObject } from '@/utils/common'
import { checkApiResult } from '@/utils/service-utils'
import { createRelayProbeRoundControllerApi } from '@/client/services/relay-probe-round-controller.gen'
import type {
  RelayProbeDailyScheduleDto,
  SaveRelayProbeDailyScheduleRequest,
  RelayProbeRoundPageDto,
  RelayProbeRoundTargetPageDto,
} from '@/client/types.gen'
const api = cacheObject(() => createRelayProbeRoundControllerApi(useRequestStore().getAxios()))

class RelayProbeRoundService {
  async schedule() {
    return checkApiResult<{ data: RelayProbeDailyScheduleDto }>(await api.getDailySchedule(), true)
      .data
  }
  async save(body: SaveRelayProbeDailyScheduleRequest) {
    return checkApiResult<{ data: RelayProbeDailyScheduleDto }>(
      await api.saveDailySchedule({ body }),
      true,
    ).data
  }
  async list(page: number, pageSize: number) {
    return checkApiResult<{ data: RelayProbeRoundPageDto }>(
      await api.listProbeRounds({ params: { page, pageSize } }),
      true,
    ).data
  }
  async detail(roundId: string, page: number, pageSize: number) {
    return checkApiResult<{ data: RelayProbeRoundTargetPageDto }>(
      await api.getProbeRound({ path: { roundId }, params: { page, pageSize } }),
      true,
    ).data
  }
}
export default new RelayProbeRoundService()
