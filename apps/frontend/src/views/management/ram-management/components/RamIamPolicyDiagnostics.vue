<template>
  <div
    v-if="diagnostics.length"
    class="policy-diagnostics"
    role="region"
    :aria-label="i18ns.t('RamManagement.policyDiagnostics')"
  >
    <section v-for="group in groups" :key="group.severity" :data-severity="group.severity">
      <h4>{{ i18ns.t(group.labelKey) }} ({{ group.items.length }})</h4>
      <ul v-if="group.items.length">
        <li v-for="(diagnostic, index) in group.items" :key="index">
          <button :data-code="diagnostic.code" type="button" @click="emit('select', diagnostic)">
            <span>{{ i18ns.t(diagnosticMessageKey(diagnostic)) }}</span>
            <code>{{ diagnostic.code }}</code>
            <span>{{
              i18ns.t('RamManagement.diagnosticPosition', {
                line: diagnostic.line,
                column: diagnostic.column,
              })
            }}</span>
            <code v-if="diagnostic.path">{{ diagnostic.path }}</code>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { IamDiagnostic, IamDiagnosticCode } from '@quyan/shared'
import { i18ns } from '@/locales'
type DiagnosticMessageKey = `RamManagement.diagnosticMessages.${IamDiagnosticCode}`
const diagnosticMessageKey = (diagnostic: IamDiagnostic): DiagnosticMessageKey =>
  `RamManagement.diagnosticMessages.${diagnostic.code}`
const props = defineProps<{ diagnostics: IamDiagnostic[] }>()
const emit = defineEmits<{ select: [diagnostic: IamDiagnostic] }>()
const severityLabels = {
  error: 'RamManagement.diagnosticSeverity.error',
  'security-warning': 'RamManagement.diagnosticSeverity.security-warning',
  warning: 'RamManagement.diagnosticSeverity.warning',
  suggestion: 'RamManagement.diagnosticSeverity.suggestion',
} as const
const groups = computed(() =>
  (['error', 'security-warning', 'warning', 'suggestion'] as const).map((severity) => ({
    severity,
    labelKey: severityLabels[severity],
    items: props.diagnostics.filter((diagnostic) => diagnostic.severity === severity),
  })),
)
</script>
<style scoped>
.policy-diagnostics {
  display: grid;
  gap: 8px;
}
h4 {
  margin: 0 0 4px;
}
ul {
  margin: 0;
  padding-inline-start: 20px;
}
button {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: start;
  padding: 6px 0;
}
code {
  overflow-wrap: anywhere;
}
[data-severity='error'] h4 {
  color: var(--el-color-danger);
}
[data-severity='security-warning'] h4 {
  color: var(--el-color-warning);
}
</style>
