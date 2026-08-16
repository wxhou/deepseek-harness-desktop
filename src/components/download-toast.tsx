import type { DownloadFinishedPayload } from '../hooks/use-harness'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../i18n/i18n-context'

const btnPrimary
  = 'inline-flex cursor-pointer items-center justify-center rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-accent2 disabled:cursor-not-allowed disabled:opacity-55'
const btnGhost
  = 'inline-flex cursor-pointer items-center justify-center rounded-md border border-line bg-panel2 px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-panel-hover'

interface DownloadToastProps {
  notice: DownloadFinishedPayload | null
  onClose: () => void
}

/** 右下角"下载已保存/失败"提示条 */
export default function DownloadToast({ notice, onClose }: DownloadToastProps) {
  const { t } = useI18n()

  if (!notice) {
    return null
  }

  const { success, path } = notice

  function revealInFolder(targetPath: string) {
    void invoke('reveal_in_folder', { path: targetPath }).catch((err) => {
      console.error('[App] reveal_in_folder failed:', err)
    })
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 flex max-w-[440px] items-start gap-3 rounded-lg border border-line bg-panel px-4 py-3 shadow-lg">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">
          {success ? t('download.saved') : t('download.failed')}
        </p>
        {success && path && (
          <p className="mt-0.5 text-xs text-muted break-all truncate">
            {t('download.saved_to')}
            :
            {path}
          </p>
        )}
      </div>
      {success && path && (
        <button className={btnPrimary} onClick={() => revealInFolder(path)}>
          {t('download.show_in_folder')}
        </button>
      )}
      <button className={btnGhost} onClick={onClose}>
        {t('download.close')}
      </button>
    </div>
  )
}
