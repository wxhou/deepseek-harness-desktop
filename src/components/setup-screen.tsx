import type { LucideIcon } from 'lucide-react'
import { CircleAlert, CircleCheck, Download, Rocket, ScanSearch } from 'lucide-react'
import { useI18n } from '../i18n/i18n-context'
import Loadable from './loadable'

export type SetupStatus = 'checking' | 'installing' | 'starting' | 'ready' | 'error'

export interface InstallProgress {
  title: string
  detail: string
  log: string
  type: string
  percentage: number
  progress: number
}

interface SetupScreenProps {
  status: SetupStatus
  title: string
  detail: string
  percentage: number
  logs: string[]
  errorMsg: string
  onRetry: () => void
}

// 各阶段对应不同图标，保持与 logo 一致的黑白中性色调
const STATUS_ICONS: Record<SetupStatus, LucideIcon> = {
  checking: ScanSearch,
  installing: Download,
  starting: Rocket,
  ready: CircleCheck,
  error: CircleAlert,
}

/**
 * 安装/更新页：基于通用 Loadable 组件渲染，
 * 视觉与官方 web shell 的 boot 加载页（AppRoot）一致。
 */
export default function SetupScreen({
  status,
  title,
  detail,
  percentage,
  logs,
  errorMsg,
  onRetry,
}: SetupScreenProps) {
  const { t } = useI18n()
  const error = status === 'error'
  const installing = status === 'installing'
  const heading = error ? t('status.error') : title || t('status.installing')
  const description = error ? '' : detail || t('status.installing')
  const StatusIcon = STATUS_ICONS[status]

  return (
    <Loadable
      icon={StatusIcon}
      title={heading}
      subtitle={error ? undefined : description}
      percentage={installing ? percentage : undefined}
      logs={installing ? logs : undefined}
      errorMsg={error ? errorMsg : undefined}
      onRetry={error ? onRetry : undefined}
    />
  )
}
