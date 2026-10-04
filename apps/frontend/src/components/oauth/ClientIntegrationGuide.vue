<template>
  <el-card class="integration-guide" shadow="never">
    <div class="integration-guide__header">
      <div>
        <div class="integration-guide__eyebrow">{{ i18ns.t('oauthGuide.eyebrow') }}</div>
        <h2>
          {{ i18ns.t(mode === 'oauth' ? 'oauthGuide.oauthTitle' : 'oauthGuide.authCenterTitle') }}
        </h2>
        <p>
          {{
            i18ns.t(
              mode === 'oauth' ? 'oauthGuide.oauthDescription' : 'oauthGuide.authCenterDescription',
            )
          }}
        </p>
      </div>
      <el-link :href="docsUrl" target="_blank" rel="noreferrer" type="primary">
        {{ i18ns.t(mode === 'oauth' ? 'oauthGuide.docsLink' : 'oauthGuide.authCenterDocsLink') }}
      </el-link>
    </div>
    <ol class="integration-guide__steps">
      <li v-for="(step, index) in steps" :key="index">
        <span class="integration-guide__number">{{ index + 1 }}</span>
        <span>{{ step }}</span>
      </li>
    </ol>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { resolveDocsUrl } from '@/config/docs'

type GuideMode = 'oauth' | 'auth-center'
const props = defineProps<{ mode: GuideMode }>()
const docsUrl = computed(() =>
  resolveDocsUrl(
    props.mode === 'oauth' ? 'oauthClientManagement' : 'authCenterClientManagement',
    i18ns.locale,
  ),
)
const steps = computed(() =>
  props.mode === 'oauth'
    ? [
        i18ns.t('oauthGuide.oauthSteps.clientType'),
        i18ns.t('oauthGuide.oauthSteps.redirect'),
        i18ns.t('oauthGuide.oauthSteps.scopes'),
        i18ns.t('oauthGuide.oauthSteps.review'),
        i18ns.t('oauthGuide.oauthSteps.integrate'),
      ]
    : [
        i18ns.t('oauthGuide.authCenterSteps.grantType'),
        i18ns.t('oauthGuide.authCenterSteps.redirectPkce'),
        i18ns.t('oauthGuide.authCenterSteps.scopes'),
        i18ns.t('oauthGuide.authCenterSteps.review'),
        i18ns.t('oauthGuide.authCenterSteps.integrate'),
      ],
)
</script>

<style scoped>
.integration-guide {
  border: 1px solid var(--el-color-primary-light-7);
  background: linear-gradient(135deg, var(--el-color-primary-light-9), var(--el-bg-color));
}
.integration-guide__header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
}
.integration-guide__eyebrow {
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.integration-guide h2 {
  margin: 4px 0 6px;
  font-size: 20px;
}
.integration-guide p {
  margin: 0;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.integration-guide__steps {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  padding: 0;
  margin: 20px 0 0;
  list-style: none;
}
.integration-guide__steps li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  line-height: 1.45;
  font-size: 13px;
}
.integration-guide__number {
  display: inline-grid;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: white;
  font-weight: 700;
}
@media (max-width: 800px) {
  .integration-guide__header {
    flex-direction: column;
  }
  .integration-guide__steps {
    grid-template-columns: 1fr;
  }
}
</style>
