<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <section class="page-card onboarding-shell">
    <h2 class="page-title">{{ t('onboarding.title') }}</h2>
    <p class="page-description">{{ t('onboarding.description') }}</p>

    <div class="welcome-banner">
      <h3 class="section-header">{{ t('onboarding.welcome') }}</h3>
      <p class="muted">{{ t('onboarding.welcomeDesc') }}</p>
    </div>

    <ol class="onboarding-steps">
      <li class="step-card">
        <div class="step-number">1</div>
        <div class="step-content">
          <h4 class="step-title">{{ t('onboarding.step1Title') }}</h4>
          <p class="step-desc">{{ t('onboarding.step1Desc') }}</p>
          <p class="step-detail muted">{{ t('onboarding.step1Detail') }}</p>
        </div>
      </li>
      <li class="step-card">
        <div class="step-number">2</div>
        <div class="step-content">
          <h4 class="step-title">{{ t('onboarding.step2Title') }}</h4>
          <p class="step-desc">{{ t('onboarding.step2Desc') }}</p>
          <p class="step-detail muted">{{ t('onboarding.step2Detail') }}</p>
        </div>
      </li>
      <li class="step-card">
        <div class="step-number">3</div>
        <div class="step-content">
          <h4 class="step-title">{{ t('onboarding.step3Title') }}</h4>
          <p class="step-desc">{{ t('onboarding.step3Desc') }}</p>
          <p class="step-detail muted">{{ t('onboarding.step3Detail') }}</p>
        </div>
      </li>
      <li class="step-card">
        <div class="step-number">4</div>
        <div class="step-content">
          <h4 class="step-title">{{ t('onboarding.step4Title') }}</h4>
          <p class="step-desc">{{ t('onboarding.step4Desc') }}</p>
          <p class="step-detail muted">{{ t('onboarding.step4Detail') }}</p>
        </div>
      </li>
    </ol>

    <div class="cta-section">
      <RouterLink to="/learning" class="button primary">{{
        t('onboarding.getStarted')
      }}</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.onboarding-shell {
  padding: 1.5rem;
}

.welcome-banner {
  margin-top: 1.5rem;
  padding: 1.2rem;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(255, 248, 233, 0.9), rgba(255, 236, 205, 0.8));
  border: 1px dashed var(--accent);
}

.welcome-banner .section-header {
  margin: 0 0 0.5rem;
}

.welcome-banner p {
  margin: 0;
  line-height: 1.6;
}

.onboarding-steps {
  margin: 2rem 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 1.2rem;
}

.step-card {
  display: flex;
  gap: 1rem;
  background: rgba(255, 255, 255, 0.82);
  border-radius: 16px;
  border: 1px solid var(--line);
  padding: 1.2rem;
  box-shadow: var(--shadow);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.step-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(26, 111, 95, 0.12);
}

.step-number {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-weight: 700;
  font-size: 1.2rem;
}

.step-content {
  flex: 1;
}

.step-title {
  margin: 0 0 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.1rem;
  color: var(--primary);
}

.step-desc {
  margin: 0 0 0.5rem;
  font-weight: 600;
}

.step-detail {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.6;
}

.cta-section {
  margin-top: 2rem;
  text-align: center;
}

.cta-section .button {
  min-width: 200px;
  padding: 0.7rem 1.5rem;
  font-size: 1.05rem;
}
</style>
