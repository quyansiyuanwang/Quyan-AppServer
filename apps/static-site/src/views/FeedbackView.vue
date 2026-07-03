<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <section class="page-card feedback-shell">
    <h2 class="page-title">{{ t('feedback.title') }}</h2>
    <p class="page-description">{{ t('feedback.description') }}</p>

    <div class="content-section">
      <h3 class="section-header">{{ t('feedback.formTitle') }}</h3>
      <p class="muted">{{ t('feedback.formDesc') }}</p>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('feedback.contactTitle') }}</h3>
      <div class="contact-grid">
        <article class="contact-card">
          <h4 class="contact-title">{{ t('feedback.contactGithub') }}</h4>
          <p class="muted">{{ t('feedback.contactGithubDesc') }}</p>
        </article>
        <article class="contact-card">
          <h4 class="contact-title">{{ t('feedback.contactEmail') }}</h4>
          <p class="muted">{{ t('feedback.contactEmailDesc') }}</p>
        </article>
      </div>
    </div>

    <div class="content-section">
      <h3 class="section-header">{{ t('feedback.bugReportTitle') }}</h3>
      <p class="muted">{{ t('feedback.bugReportDesc') }}</p>
      <ul class="bug-report-list">
        <li>{{ t('feedback.bugReport1') }}</li>
        <li>{{ t('feedback.bugReport2') }}</li>
        <li>{{ t('feedback.bugReport3') }}</li>
        <li>{{ t('feedback.bugReport4') }}</li>
      </ul>
    </div>

    <div class="thanks-banner">
      <h3 class="section-header">{{ t('feedback.thanksTitle') }}</h3>
      <p>{{ t('feedback.thanksDesc') }}</p>
    </div>
  </section>
</template>

<style scoped>
.feedback-shell {
  padding: 1.5rem;
}

.content-section {
  margin-top: 2rem;
}

.content-section p {
  line-height: 1.7;
}

.contact-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.contact-card {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.72);
}

.contact-title {
  margin: 0 0 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1rem;
  color: var(--primary);
}

.contact-card p {
  margin: 0;
  font-size: 0.95rem;
}

.bug-report-list {
  margin: 1rem 0 0 1.5rem;
  padding: 0;
  line-height: 1.8;
}

.bug-report-list li {
  margin-top: 0.5rem;
}

.thanks-banner {
  margin-top: 2rem;
  padding: 1.2rem;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(219, 245, 219, 0.8), rgba(207, 235, 255, 0.7));
  border: 1px solid var(--primary);
}

.thanks-banner .section-header {
  margin: 0 0 0.5rem;
}

.thanks-banner p {
  margin: 0;
  line-height: 1.6;
}
</style>
