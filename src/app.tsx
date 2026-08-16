import { useState } from 'react'
import DownloadToast from './components/download-toast'
import HarnessView from './components/harness-view'
import SidebarPanel from './components/sidebar-panel'
import SidebarToggle from './components/sidebar-toggle'
import UpdateToast from './components/update-toast'
import { useDshTheme } from './hooks/use-dsh-theme'
import { useHarness } from './hooks/use-harness'
/**
 * 应用根组件：组合 useHarness 业务 hook 与各视图组件，
 * 自身只保留侧边栏展开状态这类纯 UI 状态。
 */
export default function App() {
  useDshTheme()
  const {
    status,
    installer,
    errorMsg,
    serviceUrl,
    iframeError,
    iframeKey,
    serviceHealthy,
    updateInfo,
    updating,
    serviceRunning,
    busyAction,
    downloadNotice,
    iframeSrc,
    boot,
    restart,
    shutdown,
    start,
    openBrowser,
    handleUpdate,
    refreshIframe,
    markIframeLoaded,
    markIframeError,
    dismissUpdate,
    dismissDownload,
  } = useHarness()

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('sidebarOpen')
    return saved === null ? false : saved === 'true'
  })

  // 右下角触发点：展开/收起侧边栏
  function handleToggleSidebar() {
    setSidebarOpen((prev) => {
      const next = !prev
      localStorage.setItem('sidebarOpen', String(next))
      return next
    })
  }

  // 点击侧边栏外内容（遮罩）时收起侧边栏
  function handleCloseSidebar() {
    setSidebarOpen(false)
    localStorage.setItem('sidebarOpen', 'false')
  }

  const harnessViewProps = {
    installer,
    serviceHealthy,
    iframeError,
    iframeKey,
    iframeSrc,
    serviceUrl,
    onRetry: boot,
    onIframeLoad: markIframeLoaded,
    onIframeError: markIframeError,
    onRefresh: refreshIframe,
  }

  if (status === 'error') {
    return (
      <div className="flex h-screen w-screen">
        <HarnessView
          {...harnessViewProps}
          status="error"
          errorMsg={serviceUrl ? `${errorMsg} (${serviceUrl})` : errorMsg}
        />
        {!sidebarOpen && (
          <SidebarToggle lifted={false} onClick={handleToggleSidebar} />
        )}
        <SidebarPanel
          open={sidebarOpen}
          serviceRunning={serviceRunning}
          busyAction={busyAction}
          onClose={handleCloseSidebar}
          onRestart={restart}
          onShutdown={shutdown}
          onStart={start}
          onOpenBrowser={openBrowser}
        />
      </div>
    )
  }

  if (status !== 'ready') {
    return (
      <div className="flex h-screen w-screen">
        <HarnessView {...harnessViewProps} status={status} errorMsg="" />
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen">
      <HarnessView {...harnessViewProps} status="ready" errorMsg="" />
      <UpdateToast
        info={updateInfo}
        updating={updating}
        onUpdate={handleUpdate}
        onDismiss={dismissUpdate}
      />
      <DownloadToast notice={downloadNotice} onClose={dismissDownload} />
      {!sidebarOpen && (
        <SidebarToggle lifted={updateInfo !== null && !updating} onClick={handleToggleSidebar} />
      )}
      <SidebarPanel
        open={sidebarOpen}
        serviceRunning={serviceRunning}
        busyAction={busyAction}
        onClose={handleCloseSidebar}
        onRestart={restart}
        onShutdown={shutdown}
        onStart={start}
        onOpenBrowser={openBrowser}
      />
    </div>
  )
}
