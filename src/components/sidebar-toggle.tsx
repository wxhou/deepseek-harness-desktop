import { Wrench } from 'lucide-react'
import { useStore } from 'valtio-define'
import { setting, useI18n } from '../store/modules/setting'
import { updater } from '../store/modules/updater'
import { toggle } from './primitives'

/**
 * 右下角侧边栏展开按钮：显隐与位置都从 store 读取，
 * 不再接收 lifted/onClick 等 props。
 */
export default function SidebarToggle() {
  const { t } = useI18n()
  const { sidebarOpen } = useStore(setting)
  const { updateInfo, updating } = useStore(updater)

  // 侧边栏已展开时隐藏，避免与抽屉重叠
  if (sidebarOpen) {
    return null
  }

  return (
    <button
      onClick={setting.toggleSidebar}
      title={t('app.expand_sidebar')}
      className={toggle({ lifted: updateInfo !== null && !updating })}
    >
      <Wrench className="size-4" />
    </button>
  )
}
