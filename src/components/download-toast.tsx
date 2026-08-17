import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { useStore } from 'valtio-define'
import { download } from '../store/modules/download'
import { button, toast } from './primitives'

/** 右下角"下载已保存/失败"提示条：状态与关闭操作直接来自 download store */
export default function DownloadToast() {
  const { t } = useTranslation()
  const { notice } = useStore(download)

  if (!notice) {
    return null
  }

  const { success, path } = notice

  function revealInFolder(targetPath: string) {
    void invoke('reveal_in_folder', { path: targetPath }).catch((err) => {
      console.error('[Harness] reveal_in_folder failed:', err)
    })
  }

  return (
    <div className={toast({ size: 'md', align: 'start' })}>
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
        <button className={button({ tone: 'primary' })} onClick={() => revealInFolder(path)}>
          {t('download.show_in_folder')}
        </button>
      )}
      <button className={button({ tone: 'ghost' })} onClick={download.dismiss}>
        {t('download.close')}
      </button>
    </div>
  )
}
