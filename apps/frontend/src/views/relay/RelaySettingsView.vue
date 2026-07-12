<template>
  <div class="relay-settings-view">
    <RelaySettingsPageDesktop v-if="isDesktop" />
    <RelaySettingsPageMobile v-else />
    <RelaySettingsChannelDialogs />
    <RelaySettingsTimeRuleDialog />
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import RelaySettingsChannelDialogs from './relay-settings/components/RelaySettingsChannelDialogs.vue'
import RelaySettingsPageDesktop from './relay-settings/components/RelaySettingsPageDesktop.vue'
import RelaySettingsPageMobile from './relay-settings/components/RelaySettingsPageMobile.vue'
import RelaySettingsTimeRuleDialog from './relay-settings/components/RelaySettingsTimeRuleDialog.vue'
import { relaySettingsManagementContextKey } from './relay-settings/context'
import { useRelaySettingsManagement } from './relay-settings/useRelaySettingsManagement'
import './relay-settings/relay-settings.scss'

const state = useRelaySettingsManagement()

provide(relaySettingsManagementContextKey, state)

const { isDesktop } = state
</script>
