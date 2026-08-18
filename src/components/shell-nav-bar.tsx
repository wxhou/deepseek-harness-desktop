import { Minus, Square, Xmark } from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTranslation } from 'react-i18next'

/**
 * 壳层窗口导航栏（44px）：插件导航栏未加载时的回退 chrome。
 *
 * 样式与 dsh-tauri 插件导航栏完全一致（同色系、同按钮、无边框），
 * 但只承载窗口控制（最小化/最大化/后台化 + 拖拽区）——侧边栏/后退/前进
 * 属于 dsh 页面能力，由插件在 iframe 内提供。
 *
 * 显示时机：插件发来 `dsh://tauri-ready` 后由 useIframeTauri 置为隐藏，
 * 插件导航栏接管；iframe 重载/插件未安装时自动恢复显示。
 * 拖拽区用 Tauri 原生 `data-tauri-drag-region`（顶层文档直接生效），
 * 双击拖拽区切换最大化，与插件导航栏行为一致。
 */
export default function ShellNavBar() {
  const { t } = useTranslation()

  function handleWindowAction(action: 'minimize' | 'maximize' | 'background') {
    const appWindow = getCurrentWindow()
    switch (action) {
      case 'minimize':
        void appWindow.minimize()
        break
      case 'maximize':
        void appWindow.toggleMaximize()
        break
      case 'background':
        // 后台化：隐藏窗口到托盘（与关闭按钮行为一致，服务保持运行）
        void appWindow.hide()
        break
    }
  }

  return (
    <div className="dsh-tauri-nav dsh-tauri-nav--shell">
      {/* 拖拽区：Tauri 原生拖拽（仅此元素带 data-tauri-drag-region，按钮不受影响） */}
      <div
        className="dsh-tauri-nav__drag"
        data-tauri-drag-region
        onDoubleClick={() => { void getCurrentWindow().toggleMaximize() }}
      />

      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        className="dsh-tauri-nav__btn"
        aria-label={t('nav.minimize')}
        onPress={() => { handleWindowAction('minimize') }}
      >
        <Minus />
      </Button>

      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        className="dsh-tauri-nav__btn"
        aria-label={t('nav.maximize')}
        onPress={() => { handleWindowAction('maximize') }}
      >
        <Square style={{ width: 14, height: 14 }} />
      </Button>

      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        className="dsh-tauri-nav__btn dsh-tauri-nav__btn--danger"
        aria-label={t('nav.background')}
        onPress={() => { handleWindowAction('background') }}
      >
        <Xmark />
      </Button>
    </div>
  )
}
