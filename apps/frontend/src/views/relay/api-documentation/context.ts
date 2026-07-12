import { inject, type InjectionKey } from 'vue'
import type { ApiDocumentationState } from './useApiDocumentation'

export const apiDocumentationContextKey: InjectionKey<ApiDocumentationState> =
  Symbol('apiDocumentation')

export function useApiDocumentationContext(): ApiDocumentationState {
  const context = inject(apiDocumentationContextKey)

  if (!context) {
    throw new Error('ApiDocumentation context is not provided')
  }

  return context
}
