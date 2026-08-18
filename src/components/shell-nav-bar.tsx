import type { RefObject } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  LayoutSideContent,
  LayoutSideContentLeft,
  Minus,
  Square,
  Xmark,
} from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTranslation } from 'react-i18next'
import { If } from 'react-if-lite'
import { useDshPlugins } from '../hooks/use-dsh-plugins'
import { useIframeTauri } from '../hooks/use-iframe-tauri'

/**
 * 壳层窗口顶部导航栏（44px，常驻）：
 *
 *   [侧边栏(展开/收起)] [后退] [前进] [  空白拖拽区  ] [最小化][最大化][后台化(X)]
 *
 * - 侧边栏/后退/前进：经 postMessage 操控 iframe 内的 dsh 应用
 *   （`dsh://sidebar:toggle` / `dsh://page:prev` / `dsh://page:next`，
 *   由 dsh-tauri 插件或桌面端注入的导航桥脚本 NAV_SHIM_JS 执行）；
 *   折叠图标与按钮禁用态由 iframe 回报的
 *   `dsh://sidebar:collapsed` / `dsh://page:firsted` / `dsh://page:lasted` 同步。
 *   左侧控件只在「dsh-tauri 插件已启用（已安装）」且存在 iframe 时渲染：
 *   原生桥缺席时控件没有可靠接收方，避免出现点了没反应的死按钮。
 * - 空白拖拽区：Tauri 原生 `data-tauri-drag-region`（顶层文档直接生效），
 *   双击切换最大化。
 * - 窗口按钮：直接调用 Tauri 窗口 API；后台化 = 隐藏到托盘（服务保持运行）。
 *
 * 未传入 iframeRef（安装/错误/预装引导页，无 iframe 可操控）时
 * 只渲染窗口控制，不渲染左侧导航控制。
 */

/**
 * dsh-tauri 插件 id：安装后 iframe 内提供 `window.__dsh_tauri_bridge__`
 *  原生导航桥（`useDshPlugins` 实时同步其安装状态，插件增删即时生效）
 */
const TAURI_PLUGIN_ID = 'dsh-tauri'

interface ShellNavBarProps {
  /** 就绪态 iframe；传入时启用左侧导航控制 */
  iframeRef?: RefObject<HTMLIFrameElement | null>
}

export default function ShellNavBar({ iframeRef }: ShellNavBarProps) {
  const { t } = useTranslation()
  const { plugins } = useDshPlugins()
  const { sidebarCollapsed, canGoBack, canGoForward, sendNav } = useIframeTauri(iframeRef)
  // 仅当 dsh-tauri 插件启用（已安装）时显示左侧导航控件
  const tauriEnabled = plugins.some(plugin => plugin.id === TAURI_PLUGIN_ID)

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
    <div className="shell-nav">
      <If cond={iframeRef != null && tauriEnabled}>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          className="shell-nav__btn"
          aria-label={t(sidebarCollapsed ? 'nav.sidebar_expand' : 'nav.sidebar_collapse')}
          onPress={() => { sendNav('sidebar:toggle') }}
        >
          <If
            cond={sidebarCollapsed}
            then={<LayoutSideContentLeft />}
            else={<LayoutSideContent />}
          />
        </Button>

        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          className="shell-nav__btn"
          aria-label={t('nav.back')}
          isDisabled={!canGoBack}
          onPress={() => { sendNav('page:prev') }}
        >
          <ArrowLeft />
        </Button>

        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          className="shell-nav__btn"
          aria-label={t('nav.forward')}
          isDisabled={!canGoForward}
          onPress={() => { sendNav('page:next') }}
        >
          <ArrowRight />
        </Button>
      </If>

      {/* 拖拽区：Tauri 原生拖拽（仅此元素带 data-tauri-drag-region，按钮不受影响） */}
      <div
        className="shell-nav__drag"
        data-tauri-drag-region
        onDoubleClick={() => { void getCurrentWindow().toggleMaximize() }}
      />

      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        className="shell-nav__btn"
        aria-label={t('nav.minimize')}
        onPress={() => { handleWindowAction('minimize') }}
      >
        <Minus />
      </Button>

      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        className="shell-nav__btn"
        aria-label={t('nav.maximize')}
        onPress={() => { handleWindowAction('maximize') }}
      >
        <Square style={{ width: 14, height: 14 }} />
      </Button>

      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        className="shell-nav__btn shell-nav__btn--danger"
        aria-label={t('nav.background')}
        onPress={() => { handleWindowAction('background') }}
      >
        <Xmark />
      </Button>
    </div>
  )
}
