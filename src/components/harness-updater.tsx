import { useStore } from 'valtio-define'
import { useI18n } from '../store/modules/setting'
import { updater } from '../store/modules/updater'
import { button, toast } from './primitives'

/** 右下角"发现新版本"提示条：状态与操作直接来自 updater store */
export default function HarnessUpdater() {
  const { t } = useI18n()
  const { updateInfo, updating } = useStore(updater)

  if (!updateInfo || updating) {
    return null
  }

  return (
    <div className={toast()}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">{t('update.available', { tag: updateInfo.tag })}</p>
        <p className="mt-0.5 text-xs text-muted">{updateInfo.commit.slice(0, 7)}</p>
      </div>
      <button className={button({ tone: 'primary' })} onClick={updater.handleUpdate}>
        {t('update.now')}
      </button>
      <button className={button({ tone: 'ghost' })} onClick={updater.dismissUpdate}>
        {t('update.later')}
      </button>
    </div>
  )
}
