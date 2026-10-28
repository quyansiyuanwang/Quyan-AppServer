<template>
  <details v-if="dependencies.length" data-test="action-dependencies" class="dependency-panel">
    <summary>{{ i18ns.t('RamManagement.visualDependencies') }} ({{ dependencies.length }})</summary>
    <p>{{ i18ns.t('RamManagement.visualDependenciesHint') }}</p>
    <ul>
      <li
        v-for="entry in dependencies"
        :key="
          [
            entry.action,
            entry.scope,
            entry.dependencyAction,
            entry.resourceRole,
            entry.selection,
          ].join(':')
        "
        data-test="action-dependency"
        :data-scope="entry.scope"
      >
        <code>{{ entry.action }}</code> → <code>{{ entry.dependencyAction }}</code>
        <p>{{ i18ns.t(scopeLabels[entry.scope]) }}</p>
        <template v-if="entry.scope === 'cross-resource' && entry.resourceRole && entry.selection">
          <p>
            {{ i18ns.t(roleLabels[entry.resourceRole]) }} ·
            <code>{{ entry.resourceTypes.join(', ') }}</code>
          </p>
          <p>{{ i18ns.t(selectionLabels[entry.selection]) }}</p>
        </template>
      </li>
    </ul>
  </details>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { i18ns } from '@/locales'
import { visualActionDependencies } from '../iam-visual-policy'
const props = defineProps<{ actions: string[] }>()
const dependencies = computed(() => visualActionDependencies(props.actions))
const scopeLabels = {
  'same-resource': 'RamManagement.visualDependencySameResource',
  conditional: 'RamManagement.visualDependencyConditional',
  'cross-resource': 'RamManagement.visualDependencyCrossResource',
} as const
const roleLabels = {
  source: 'RamManagement.visualDependencySource',
  destination: 'RamManagement.visualDependencyDestination',
  reference: 'RamManagement.visualDependencyReference',
} as const
const selectionLabels = {
  'server-reserved': 'RamManagement.visualDependencyReserved',
  'server-resolved': 'RamManagement.visualDependencyResolved',
} as const
</script>
<style scoped>
.dependency-panel {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 12px;
}
summary {
  cursor: pointer;
}
li + li {
  margin-top: 12px;
}
p {
  margin: 6px 0;
}
code {
  overflow-wrap: anywhere;
}
</style>
