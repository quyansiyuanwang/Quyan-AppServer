import { aprilFoolsEventBus } from '@/stores/globalInstance'

type TriggerEggPayload = {
  id: number
  force?: boolean
}

export const AprilFoolsService = {
  triggerEgg(payload: TriggerEggPayload) {
    aprilFoolsEventBus.emit('TRIGGER_EGG', payload)
  },
  triggerRandom(force = false) {
    aprilFoolsEventBus.emit('TRIGGER_RANDOM_EGG', { force })
  },
  runAutoSequence() {
    aprilFoolsEventBus.emit('RUN_AUTO_SEQUENCE')
  },
  openPanel() {
    aprilFoolsEventBus.emit('OPEN_PANEL')
  },
  syncLocalState() {
    aprilFoolsEventBus.emit('SYNC_LOCAL_STATE')
  },
}
