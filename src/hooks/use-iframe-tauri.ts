import type { RefObject } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useState } from 'react'
import { useEvent } from 'react-use'

/**
 * dsh-tauri 插件桥：监听 iframe（dsh web UI）内插件发来的窗口控制事件。
 *
 * 协议（iframe → 宿主，postMessage）：
 * - `{ source: 'dsh-tauri', type: 'dsh://tauri-ready' }`
 *   插件导航栏挂载完成 → 隐藏壳层自定义导航栏（ShellNavBar），由插件接管；
 * - `{ source: 'dsh-tauri', type: 'dsh://window-control', action }`
 *   action: minimize | maximize | background | drag-start，对应 Tauri 窗口操作。
 *
 * 只在 iframe 直接发来的消息上生效（event.source 校验），与通知桥一致；
 * iframe 每次重新加载时恢复壳层导航栏（插件未挂载期间窗口仍有可用 chrome）。
 *
 * @returns tauriNavActive —— 插件导航栏是否已接管（壳层导航栏应隐藏）。
 */
interface TauriControlMessage {
  source?: 'dsh-tauri'
  type?: 'dsh://tauri-ready' | 'dsh://window-control'
  action?: 'minimize' | 'maximize' | 'background' | 'drag-start'
}

export function useIframeTauri(iframeRef: RefObject<HTMLIFrameElement | null>): boolean {
  // 插件导航栏是否已接管（决定壳层 ShellNavBar 的显隐）
  const [tauriNavActive, setTauriNavActive] = useState(false)

  function handleMessage(event: MessageEvent<TauriControlMessage>) {
    const data = event.data
    if (!data || typeof data !== 'object' || data.source !== 'dsh-tauri') {
      return
    }
    // 只接受 DSH 直接 iframe 发来的消息；不兼容多层嵌套 iframe。
    if (event.source !== iframeRef.current?.contentWindow) {
      return
    }

    if (data.type === 'dsh://tauri-ready') {
      // 插件导航栏已就绪：隐藏壳层自定义导航栏，插件栏接管窗口 chrome
      setTauriNavActive(true)
      // ack：插件据此停止重试（握手收敛）
      iframeRef.current?.contentWindow?.postMessage(
        { source: 'dsh-tauri', type: 'dsh://tauri-ack' },
        '*',
      )
      return
    }

    if (data.type !== 'dsh://window-control') {
      return
    }

    const appWindow = getCurrentWindow()
    switch (data.action) {
      case 'minimize':
        void appWindow.minimize().catch(error => console.error('[tauri-nav] minimize failed:', error))
        break
      case 'maximize':
        void appWindow.toggleMaximize().catch(error => console.error('[tauri-nav] toggleMaximize failed:', error))
        break
      case 'background':
        // 后台化：隐藏窗口到托盘（与关闭按钮行为一致，服务保持运行）
        void appWindow.hide().catch(error => console.error('[tauri-nav] hide failed:', error))
        break
      case 'drag-start':
        // 空白区拖拽：窗口移动循环由 Tauri 接管
        void appWindow.startDragging().catch(error => console.error('[tauri-nav] startDragging failed:', error))
        break
      default:
        break
    }
  }

  useEvent('message', handleMessage)

  return tauriNavActive
}
