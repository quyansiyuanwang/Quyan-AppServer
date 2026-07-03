<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
const { t } = useI18n()
</script>

<template>
  <section class="page-card">
    <h2 class="page-title">{{ t('notFound.title') }}</h2>
    <p class="page-description">{{ t('notFound.description') }}</p>
    <div class="notfound-links">
      <RouterLink to="/" class="button primary">{{ t('notFound.home') }}</RouterLink>
      <RouterLink to="/learning" class="button">{{ t('notFound.learning') }}</RouterLink>
      <RouterLink to="/games" class="button">{{ t('notFound.games') }}</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.notfound-links {
  margin-top: 1.5rem;
  display: flex;
  gap: 1.1rem;
  flex-wrap: wrap;
}
</style>
