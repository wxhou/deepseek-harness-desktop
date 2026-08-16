import type { DownloadFinishedPayload } from '../hooks/use-harness'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../i18n/i18n-context'

// 官方按钮：胶囊形 + 中性品牌色（对应 ui-primitives Button）
const btnPrimary
  = 'inline-flex h-9 cursor-pointer items-center justify-center gap-1 rounded-[18px] bg-btn-fill px-3.5 text-sm leading-[22px] text-btn-ink transition-colors hover:bg-btn-fill-hover disabled:cursor-not-allowed disabled:opacity-40'
const btnGhost
  = 'inline-flex h-9 cursor-pointer items-center justify-center gap-1 rounded-[18px] px-3.5 text-sm leading-[22px] text-ink transition-colors hover:bg-btn-hover active:bg-btn-active'

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
