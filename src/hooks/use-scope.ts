import type { Scope } from './define-scope'
import { use } from 'react'

export function useScope<T>(scope: Scope<T>) {
  const value = use(scope.Context)
  if (!value)
    throw new Error('Scope not found')
  return value
}
