import { Wrench } from 'lucide-react'
import { useI18n } from '../i18n/i18n-context'

interface SidebarToggleProps {
  /** 上方有提示条时上移，避免重叠 */
  lifted: boolean
  onClick: () => void
}

/** 右下角侧边栏展开按钮 */
export default function SidebarToggle({ lifted, onClick }: SidebarToggleProps) {
  const { t } = useI18n()

  return (
    <button
      onClick={onClick}
      title={t('app.expand_sidebar')}
      className={`fixed right-4 z-20 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-panel/80 text-ink shadow-lg backdrop-blur-md transition-colors hover:bg-panel-hover ${
        lifted ? 'bottom-[84px]' : 'bottom-4'
      }`}
    >
      <Wrench className="size-4" />
    </button>
  )
}
