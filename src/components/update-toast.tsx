import type { DshUpdateInfo } from '../hooks/use-harness'
import { useI18n } from '../i18n/i18n-context'

const btnPrimary
  = 'inline-flex cursor-pointer items-center justify-center rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-accent2 disabled:cursor-not-allowed disabled:opacity-55'
const btnGhost
  = 'inline-flex cursor-pointer items-center justify-center rounded-md border border-line bg-panel2 px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-panel-hover'

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
    <div className="fixed right-4 bottom-4 z-50 flex max-w-[420px] items-center gap-3 rounded-lg border border-accent/40 bg-panel px-4 py-3 shadow-lg">
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
