<script setup lang="ts">
import { provide } from 'vue'
import NotificationSettingsDesktop from './notification-settings/components/NotificationSettingsDesktop.vue'
import NotificationSettingsMobile from './notification-settings/components/NotificationSettingsMobile.vue'
import NotificationSettingsWebhookDialog from './notification-settings/components/NotificationSettingsWebhookDialog.vue'
import { notificationSettingsContextKey } from './notification-settings/context'
import { useNotificationSettings } from './notification-settings/useNotificationSettings'
import './notification-settings/notification-settings.scss'

const state = useNotificationSettings()

provide(notificationSettingsContextKey, state)
</script>

<template>
  <div class="notification-settings-page-root">
    <NotificationSettingsDesktop v-if="state.isDesktop.value" />
    <NotificationSettingsMobile v-else />
    <NotificationSettingsWebhookDialog />
  </div>
</template>
