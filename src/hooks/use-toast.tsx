import type { ToastVariants } from '@heroui/styles'
import type { HeroUIToastOptions } from 'node_modules/@heroui/react/dist/components/toast/toast-queue'
import { ToastQueue } from '@heroui/react'
import { defineScope } from './define-scope'
import { useScope } from './use-scope'

type Placement = NonNullable<ToastVariants['placement']>
export const placements = [
  'top start',
  'top',
  'top end',
  'bottom start',
  'bottom',
  'bottom end',
] as const

// Create a separate queue for each placement
export const queues = Object.fromEntries(
  placements.map(p => [p, new ToastQueue({ maxVisibleToasts: 3 })]),
) as Record<Placement, ToastQueue>

// 记录每个 toast key 所属的 placement，close(key) 时才能找到对应队列
const keyPlacements = new Map<string, Placement>()

export function toast(
  message: string,
  options: HeroUIToastOptions & { placement?: Placement },
) {
  const { placement = 'top', ...rest } = options
  const key = queues[placement].add({ title: message, ...rest })
  keyPlacements.set(key, placement)
  return key
}

function close(key: string) {
  const placement = keyPlacements.get(key)
  keyPlacements.delete(key)
  if (placement)
    queues[placement].close(key)
}

function clear() {
  keyPlacements.clear()
  placements.forEach(p => queues[p].clear())
}

toast.close = close
toast.clear = clear

export const ToastScope = defineScope(() => {
  return { toast, queues, close, clear }
})

export function useToast() {
  return useScope(ToastScope)
}
