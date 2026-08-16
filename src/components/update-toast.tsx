import type { DshUpdateInfo } from '../hooks/use-harness'
import { useI18n } from '../i18n/i18n-context'

// 官方按钮：胶囊形 + 中性品牌色（对应 ui-primitives Button）
const btnPrimary
  = 'inline-flex h-9 cursor-pointer items-center justify-center gap-1 rounded-[18px] bg-btn-fill px-3.5 text-sm leading-[22px] text-btn-ink transition-colors hover:bg-btn-fill-hover disabled:cursor-not-allowed disabled:opacity-40'
const btnGhost
  = 'inline-flex h-9 cursor-pointer items-center justify-center gap-1 rounded-[18px] px-3.5 text-sm leading-[22px] text-ink transition-colors hover:bg-btn-hover active:bg-btn-active'

interface UpdateToastProps {
  info: DshUpdateInfo | null
  updating: boolean
  onUpdate: () => void
  onDismiss: () => void
}

/** 右下角"发现新版本"提示条 */
export default function UpdateToast({ info, updating, onUpdate, onDismiss }: UpdateToastProps) {
  const { t } = useI18n()

  if (!info || updating) {
    return null
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 flex max-w-[420px] items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 shadow-lg">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">{t('update.available', { tag: info.tag })}</p>
        <p className="mt-0.5 text-xs text-muted">{info.commit.slice(0, 7)}</p>
      </div>
      <button className={btnPrimary} onClick={onUpdate}>
        {t('update.now')}
      </button>
      <button className={btnGhost} onClick={onDismiss}>
        {t('update.later')}
      </button>
    </div>
  )
}
