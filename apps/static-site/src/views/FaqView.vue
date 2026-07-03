<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const openItems = ref<Set<string>>(new Set())

const toggleItem = (id: string) => {
  if (openItems.value.has(id)) {
    openItems.value.delete(id)
  } else {
    openItems.value.add(id)
  }
}

const isOpen = (id: string) => openItems.value.has(id)

const faqSections = [
  {
    title: 'learningSection',
    items: [
      { id: 'q1', question: 'q1', answer: 'a1' },
      { id: 'q2', question: 'q2', answer: 'a2' },
      { id: 'q3', question: 'q3', answer: 'a3' },
      { id: 'q4', question: 'q4', answer: 'a4' },
    ],
  },
  {
    title: 'gamesSection',
    items: [
      { id: 'q5', question: 'q5', answer: 'q5_a' },
      { id: 'q6', question: 'q6', answer: 'q6_a' },
    ],
  },
  {
    title: 'techSection',
    items: [
      { id: 'q7', question: 'q7', answer: 'q7_a' },
      { id: 'q8', question: 'q8', answer: 'q8_a' },
      { id: 'q9', question: 'q9', answer: 'q9_a' },
    ],
  },
]
</script>

<template>
  <section class="page-card faq-shell">
    <h2 class="page-title">{{ t('faq.title') }}</h2>
    <p class="page-description">{{ t('faq.description') }}</p>

    <div v-for="section in faqSections" :key="section.title" class="faq-section">
      <h3 class="section-header">{{ t(`faq.${section.title}`) }}</h3>
      <div class="faq-list">
        <article
          v-for="item in section.items"
          :key="item.id"
          class="faq-item"
          :class="{ open: isOpen(item.id) }"
        >
          <button class="faq-question" @click="toggleItem(item.id)">
            <span>{{ t(`faq.${item.question}`) }}</span>
            <span class="faq-icon">{{ isOpen(item.id) ? '−' : '+' }}</span>
          </button>
          <div v-if="isOpen(item.id)" class="faq-answer">
            {{ t(`faq.${item.answer}`) }}
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.faq-shell {
  padding: 1.5rem;
}

.faq-section {
  margin-top: 2rem;
}

.faq-list {
  display: grid;
  gap: 0.8rem;
  margin-top: 1rem;
}

.faq-item {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  overflow: hidden;
  transition: box-shadow 0.2s ease;
}

.faq-item.open {
  box-shadow: 0 4px 12px rgba(26, 111, 95, 0.1);
}

.faq-question {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: transparent;
  border: none;
  text-align: left;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 700;
  color: var(--ink);
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.faq-question:hover {
  background: rgba(26, 111, 95, 0.05);
}

.faq-icon {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--primary);
  flex-shrink: 0;
  line-height: 1;
}

.faq-answer {
  padding: 0 1rem 1rem 1rem;
  color: var(--muted);
  line-height: 1.7;
  animation: fade-in 0.3s ease;
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
