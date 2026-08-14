<template>
  <div class="oauth-authorize-page" :class="{ 'oauth-authorize-page--mobile': !isDesktop }">
    <el-card class="oauth-authorize-card surface-card" shadow="hover">
      <template v-if="loading">
        <el-skeleton animated :rows="8" />
      </template>

      <template v-else-if="preview">
        <div class="oauth-authorize-shell">
          <div class="oauth-authorize-hero">
            <span class="oauth-authorize-kicker">OAuth 2.0</span>
            <h1>{{ i18ns.t('oauthAuthorize.title') }}</h1>
            <p class="oauth-authorize-subtitle">
              {{ i18ns.t('oauthAuthorize.subtitle', { appName: preview.client.name }) }}
            </p>
          </div>

          <div class="oauth-authorize-layout">
            <section class="oauth-panel oauth-panel--identity">
              <div class="oauth-authorize-header">
                <img
                  v-if="preview.client.logoUrl"
                  :src="preview.client.logoUrl"
                  :alt="preview.client.name"
                  class="oauth-authorize-logo"
                />
                <div v-else class="oauth-authorize-logo oauth-authorize-logo--fallback">
                  {{ getClientInitial(preview.client.name) }}
                </div>

                <div class="oauth-authorize-title-wrap">
                  <div class="oauth-authorize-app-row">
                    <h2>{{ preview.client.name }}</h2>
                    <span
                      class="oauth-authorize-status"
                      :class="{ 'is-warning': preview.requireConsent }"
                    >
                      {{
                        preview.requireConsent
                          ? i18ns.t('oauthAuthorize.consentRequired')
                          : i18ns.t('oauthAuthorize.alreadyAuthorized')
                      }}
                    </span>
                  </div>
                  <p v-if="preview.client.description" class="oauth-authorize-description">
                    {{ preview.client.description }}
                  </p>
                </div>
              </div>

              <el-alert
                v-if="preview.requireConsent"
                type="warning"
                :closable="false"
                class="oauth-authorize-alert"
              >
                {{ i18ns.t('oauthAuthorize.consentRequired') }}
              </el-alert>
              <el-alert v-else type="success" :closable="false" class="oauth-authorize-alert">
                {{ i18ns.t('oauthAuthorize.alreadyAuthorized') }}
              </el-alert>

              <div class="oauth-authorize-meta-card">
                <div class="oauth-authorize-meta-item">
                  <span>{{ i18ns.t('oauthAuthorize.clientId') }}</span>
                  <strong>{{ preview.client.clientId }}</strong>
                </div>
                <div class="oauth-authorize-meta-item">
                  <span>{{ i18ns.t('oauthAuthorize.redirectUri') }}</span>
                  <strong>{{ preview.redirectUri }}</strong>
                </div>
              </div>

              <div
                v-if="
                  preview.client.homepageUrl || preview.client.policyUrl || preview.client.tosUrl
                "
                class="oauth-authorize-links"
              >
                <a
                  v-if="preview.client.homepageUrl"
                  :href="preview.client.homepageUrl"
                  target="_blank"
                  rel="noopener"
                  >{{ i18ns.t('oauthAuthorize.homepage') }}</a
                >
                <a
                  v-if="preview.client.policyUrl"
                  :href="preview.client.policyUrl"
                  target="_blank"
                  rel="noopener"
                  >{{ i18ns.t('oauthAuthorize.privacyPolicy') }}</a
                >
                <a
                  v-if="preview.client.tosUrl"
                  :href="preview.client.tosUrl"
                  target="_blank"
                  rel="noopener"
                  >{{ i18ns.t('oauthAuthorize.termsOfService') }}</a
                >
              </div>
            </section>

            <section class="oauth-panel oauth-panel--scopes">
              <div class="oauth-authorize-summary-grid">
                <div class="oauth-authorize-summary-item">
                  <span>{{ i18ns.t('oauthAuthorize.requestedScopes') }}</span>
                  <strong>{{ preview.requestedScopes.length }}</strong>
                </div>
                <div class="oauth-authorize-summary-item">
                  <span>{{ i18ns.t('oauthAuthorize.newScopes') }}</span>
                  <strong>{{ preview.missingScopes.length }}</strong>
                </div>
              </div>

              <div class="oauth-authorize-section oauth-authorize-section--compact">
                <h3>{{ i18ns.t('oauthAuthorize.requestedScopes') }}</h3>
                <div class="oauth-authorize-tags">
                  <el-tag
                    v-for="scope in preview.requestedScopes"
                    :key="scope"
                    type="primary"
                    effect="light"
                    class="oauth-authorize-tag"
                  >
                    {{ scope }}
                  </el-tag>
                </div>
              </div>

              <div
                v-if="preview.missingScopes.length"
                class="oauth-authorize-section oauth-authorize-section--compact"
              >
                <h3>{{ i18ns.t('oauthAuthorize.newScopes') }}</h3>
                <div class="oauth-authorize-tags">
                  <el-tag
                    v-for="scope in preview.missingScopes"
                    :key="scope"
                    type="warning"
                    effect="light"
                    class="oauth-authorize-tag"
                  >
                    {{ scope }}
                  </el-tag>
                </div>
              </div>

              <div class="oauth-authorize-actions">
                <el-button :disabled="submitting" size="large" @click="handleDecision(false)">
                  {{ i18ns.t('oauthAuthorize.deny') }}
                </el-button>
                <el-button
                  type="primary"
                  size="large"
                  :loading="submitting"
                  @click="handleDecision(true)"
                >
                  {{ i18ns.t('oauthAuthorize.approve') }}
                </el-button>
              </div>
            </section>
          </div>
        </div>
      </template>

      <template v-else>
        <el-empty :description="i18ns.t('oauthAuthorize.invalidRequest')" />
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute } from 'vue-router'
import { i18ns } from '@/locales'
import { usePageDevice } from '@/composables/usePageDevice'
import {
  OAuthAuthorizationFrontendService,
  type OAuthAuthorizeQuery,
  type OAuthAuthorizationPreview,
} from '@/service/oauthAuthorizationService'

const route = useRoute()
const { isDesktop } = usePageDevice()
const oauthAuthorizationService = OAuthAuthorizationFrontendService.getInstance()

const loading = ref(false)
const submitting = ref(false)
const preview = ref<OAuthAuthorizationPreview | null>(null)

const authorizeQuery = computed<OAuthAuthorizeQuery | null>(() => {
  const response_type = String(route.query.response_type || '').trim()
  const client_id = String(route.query.client_id || '').trim()
  const redirect_uri = String(route.query.redirect_uri || '').trim()

  if (response_type !== 'code' || !client_id || !redirect_uri) return null

  const query: OAuthAuthorizeQuery = {
    response_type: 'code',
    client_id,
    redirect_uri,
  }

  const scope = String(route.query.scope || '').trim()
  const state = String(route.query.state || '').trim()
  const code_challenge = String(route.query.code_challenge || '').trim()
  const code_challenge_method = String(route.query.code_challenge_method || '').trim()
  const nonce = String(route.query.nonce || '').trim()

  if (scope) query.scope = scope
  if (state) query.state = state
  if (code_challenge) query.code_challenge = code_challenge
  if (code_challenge_method === 'S256' || code_challenge_method === 'plain') {
    query.code_challenge_method = code_challenge_method
  }
  if (nonce) query.nonce = nonce

  return query
})

const loadPreview = async () => {
  if (!authorizeQuery.value) return
  loading.value = true
  try {
    const result = await oauthAuthorizationService.getPreview(authorizeQuery.value)
    preview.value = result.data
  } catch (error) {
    ElMessage.error(i18ns.t('oauthAuthorize.loadFailed'))
    throw error
  } finally {
    loading.value = false
  }
}

const handleDecision = async (approve: boolean) => {
  if (!authorizeQuery.value) return
  submitting.value = true
  try {
    const result = await oauthAuthorizationService.decide(authorizeQuery.value, approve)
    const redirectTo = result.data.redirectTo
    const { assignDocument } = await import('@/service/navigationService')
    assignDocument(redirectTo)
  } catch (error) {
    ElMessage.error(i18ns.t('oauthAuthorize.submitFailed'))
    throw error
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  void loadPreview()
})

const getClientInitial = (name: string) => {
  return name.trim().charAt(0).toUpperCase() || 'A'
}
</script>

<style scoped>
.oauth-authorize-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  background:
    radial-gradient(circle at top left, rgb(64 158 255 / 10%), transparent 32%),
    radial-gradient(circle at bottom right, rgb(103 194 58 / 8%), transparent 28%);
}

.oauth-authorize-card {
  width: min(1040px, 100%);
  border-radius: 28px;
  overflow: hidden;
}

.oauth-authorize-shell {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.oauth-authorize-hero h1 {
  margin: 10px 0 8px;
  font-size: clamp(1.85rem, 2.4vw, 2.5rem);
  line-height: 1.12;
}

.oauth-authorize-kicker {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--el-color-primary);
  background: rgb(from var(--el-color-primary) r g b / 12%);
}

.oauth-authorize-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
  gap: 20px;
}

.oauth-panel {
  border: 1px solid var(--el-border-color-light);
  border-radius: 24px;
  padding: 24px;
  background: color-mix(in srgb, var(--el-fill-color-blank) 88%, var(--el-color-primary) 12%);
}

.oauth-panel--scopes {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.oauth-authorize-header {
  display: flex;
  gap: 18px;
  align-items: flex-start;
}

.oauth-authorize-logo {
  width: 76px;
  height: 76px;
  border-radius: 22px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 14px 30px rgb(15 23 42 / 14%);
}

.oauth-authorize-logo--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 700;
  color: var(--el-color-primary);
  background: linear-gradient(135deg, rgb(64 158 255 / 16%), rgb(64 158 255 / 8%));
}

.oauth-authorize-title-wrap {
  min-width: 0;
  flex: 1;
}

.oauth-authorize-app-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 12px;
  align-items: center;
}

.oauth-authorize-app-row h2 {
  margin: 0;
  font-size: 1.4rem;
  line-height: 1.25;
}

.oauth-authorize-status {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-success);
  background: rgb(from var(--el-color-success) r g b / 12%);
}

.oauth-authorize-status.is-warning {
  color: var(--el-color-warning);
  background: rgb(from var(--el-color-warning) r g b / 13%);
}

.oauth-authorize-description {
  margin: 12px 0 0;
  color: var(--el-text-color-regular);
  line-height: 1.7;
}

.oauth-authorize-subtitle {
  margin: 0;
  color: var(--el-text-color-secondary);
  max-width: 720px;
}

.oauth-authorize-alert {
  margin-top: 22px;
}

.oauth-authorize-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.oauth-authorize-summary-item {
  padding: 18px;
  border-radius: 20px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
}

.oauth-authorize-summary-item span {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: 0.92rem;
}

.oauth-authorize-summary-item strong {
  display: block;
  margin-top: 10px;
  font-size: 1.85rem;
  line-height: 1;
}

.oauth-authorize-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.oauth-authorize-section--compact h3 {
  margin: 0;
  font-size: 1rem;
}

.oauth-authorize-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.oauth-authorize-tag {
  margin: 0;
  padding-inline: 4px;
}

.oauth-authorize-meta-card {
  margin-top: 22px;
  display: grid;
  gap: 14px;
}

.oauth-authorize-meta-item {
  padding: 16px 18px;
  border-radius: 18px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
}

.oauth-authorize-meta-item span {
  display: block;
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 0.92rem;
}

.oauth-authorize-meta-item strong {
  display: block;
  font-weight: 600;
  line-height: 1.55;
  word-break: break-all;
}

.oauth-authorize-links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 22px;
}

.oauth-authorize-links a {
  display: inline-flex;
  align-items: center;
  padding: 10px 14px;
  border-radius: 999px;
  text-decoration: none;
  color: var(--el-color-primary);
  background: rgb(from var(--el-color-primary) r g b / 10%);
}

.oauth-authorize-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: auto;
}

.oauth-authorize-page--mobile {
  padding: 12px;
}

@media (max-width: 768px) {
  .oauth-authorize-card {
    border-radius: 22px;
  }

  .oauth-authorize-layout,
  .oauth-authorize-summary-grid {
    grid-template-columns: 1fr;
  }

  .oauth-authorize-actions {
    flex-direction: column-reverse;
  }

  .oauth-authorize-actions .el-button {
    width: 100%;
  }

  .oauth-panel {
    padding: 18px;
    border-radius: 20px;
  }

  .oauth-authorize-header {
    flex-direction: column;
  }
}
</style>
