import type { UnlistenFn } from '@tauri-apps/api/event'
import type { InstallProgress, SetupStatus } from '../components/setup-screen'
import type { SidebarBusyAction } from '../components/sidebar-panel'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/i18n-context'
import { generateTimestampedUrl } from './use-auto-sync'

const MAX_RETRIES = 8

export interface InstallerState {
  title: string
  detail: string
  percentage: number
  logs: string[]
}

export interface DshUpdateInfo {
  tag: string
  commit: string
}

/** Rust 侧 on_download 接管下载后 emit 的完成事件载荷 */
export interface DownloadFinishedPayload {
  url: string
  path: string | null
  success: boolean
}

const initialInstaller: InstallerState = {
  title: '',
  detail: '',
  percentage: 0,
  logs: [],
}

/**
 * 桌面外壳核心业务 hook：安装/更新流程、服务生命周期（启动/健康检查/重启/停止）、
 * iframe 加载状态与挂起兜底、版本更新检查、下载完成提示。
 *
 * 内部方法一律使用 function 声明（不用箭头），内嵌回调（事件监听、setTimeout 等）
 * 除外；boot 的启动 effect 靠 bootStartedRef 保证只执行一次。
 */
export function useHarness() {
  const { t } = useI18n()
  const [status, setStatus] = useState<SetupStatus>('ready')
  const [installer, setInstaller] = useState<InstallerState>(initialInstaller)
  const [errorMsg, setErrorMsg] = useState('')
  const [serviceUrl, setServiceUrl] = useState('http://127.0.0.1:3080')
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [iframeError, setIframeError] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)
  const [serviceHealthy, setServiceHealthy] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<DshUpdateInfo | null>(null)
  const [updating, setUpdating] = useState(false)
  const [serviceRunning, setServiceRunning] = useState(false)
  const [busyAction, setBusyAction] = useState<SidebarBusyAction>(null)
  const [downloadNotice, setDownloadNotice] = useState<DownloadFinishedPayload | null>(null)

  const bootTokenRef = useRef(0)
  const bootStartedRef = useRef(false)

  const iframeSrc = useMemo(() => generateTimestampedUrl(serviceUrl), [serviceUrl])

  // 刷新 iframe：清除加载态并延迟重新挂载
  function refreshIframe() {
    setIframeLoaded(false)
    setIframeError(false)
    setTimeout(() => setIframeKey(prev => prev + 1), 800)
  }

  // iframe 加载成功/失败时由视图回调更新状态
  function markIframeLoaded() {
    setIframeLoaded(true)
    setIframeError(false)
  }

  function markIframeError() {
    setIframeError(true)
    setIframeLoaded(false)
  }

  async function checkHealthViaProxy(): Promise<boolean> {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('health check timeout')), 8000)
      })
      const resultPromise = invoke<string>('proxy_health_check')
      const result = await Promise.race([resultPromise, timeoutPromise])

      const lower = result.toLowerCase()
      if (
        lower.includes('healthy')
        || lower.includes('ready')
        || result.includes('200')
        || result.includes('201')
        || lower.includes('ok')
      ) {
        console.warn('[App] health check passed:', result)
        return true
      }
      console.warn('[App] health check returned:', result)
      return false
    }
    catch (err) {
      const message = String(err)
      if (message.includes('502') || message.includes('Bad Gateway')) {
        console.warn('[App] transient 502 during health check, retrying')
      }
      else {
        console.error('[App] health check failed:', err)
      }
      return false
    }
  }

  // 安装进度流：只前进不后退，供首次安装/手动更新共用
  async function listenInstallProgress(): Promise<UnlistenFn> {
    return listen<InstallProgress>('install-progress', (e) => {
      const payload = e.payload
      setInstaller((prev) => {
        if (payload.percentage < prev.percentage) {
          return prev
        }
        const logs = payload.log
          ? [...prev.logs, payload.log].slice(-5)
          : prev.logs
        return {
          title: payload.title || prev.title,
          detail: payload.detail || prev.detail,
          percentage: payload.percentage,
          logs,
        }
      })
    })
  }

  // 后台静默检查是否有新版 Harness（网络失败/API 限流时静默跳过）
  async function checkForUpdate() {
    try {
      const info = await invoke<DshUpdateInfo | null>('check_dsh_update')
      if (info) {
        setUpdateInfo(info)
      }
    }
    catch (err) {
      console.warn('[App] update check skipped:', err)
    }
  }

  // 拉起服务并等待健康检查通过，通过后才挂载 iframe
  async function launchAndWait() {
    setStatus('ready')
    setInstaller(initialInstaller)
    setServiceHealthy(false)
    setIframeLoaded(false)
    setIframeError(false)
    await invoke('launch_harness')
    setServiceRunning(true)

    let healthy = false
    for (let attempt = 0; attempt < MAX_RETRIES && !healthy; attempt++) {
      healthy = await checkHealthViaProxy()
      if (!healthy) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
    if (!healthy) {
      throw new Error(
        t('errors.service_start_timeout', { port: new URL(serviceUrl).port || '3080' }),
      )
    }
    setServiceHealthy(true)
  }

  async function boot() {
    const token = ++bootTokenRef.current
    // 回到加载态：已安装时不再显示检测/启动界面，直接进入页面加载状态
    setServiceHealthy(false)
    setIframeLoaded(false)
    setIframeError(false)
    let unlistenInstall: UnlistenFn | null = null

    try {
      // 事件监听失败（例如 IPC 自定义协议被 CSP 拦截、回退 postMessage 也异常）
      // 不应阻断启动流程，因此容错跳过。
      try {
        unlistenInstall = await listenInstallProgress()
      }
      catch (err) {
        console.error('[App] failed to listen install-progress:', err)
      }
      const runtimeInfo = await invoke<{ service_url: string }>('get_runtime_info')
      setServiceUrl(runtimeInfo.service_url)

      // 已安装过则跳过安装界面，避免每次启动都闪现“正在安装依赖...”
      const config = await invoke<{ installed: boolean }>('get_app_config')

      // 仅首次使用需要检测环境/安装依赖；之后直接进入页面
      if (!config.installed) {
        setStatus('installing')
        setInstaller({ ...initialInstaller, title: t('status.installing') })
        await invoke('install_dependencies')
      }

      await launchAndWait()

      if (token !== bootTokenRef.current)
        return
      // 已安装时后台静默检查新版，发现后提示用户
      if (config.installed) {
        void checkForUpdate()
      }
    }
    catch (err) {
      if (token !== bootTokenRef.current)
        return
      console.error('[App] startup failed:', err)
      setErrorMsg(String(err))
      setStatus('error')
      setServiceRunning(false)
    }
    finally {
      unlistenInstall?.()
    }
  }

  // 手动更新：重新下载安装新版并重启服务
  async function handleUpdate() {
    if (updating)
      return
    setUpdating(true)
    setUpdateInfo(null)
    let unlistenInstall: UnlistenFn | null = null
    try {
      unlistenInstall = await listenInstallProgress()
      setStatus('installing')
      setInstaller({ ...initialInstaller, title: t('status.updating') })
      await invoke('install_dependencies')
      await launchAndWait()
      setUpdateInfo(null)
    }
    catch (err) {
      console.error('[App] update failed:', err)
      setErrorMsg(String(err))
      setStatus('error')
      setServiceRunning(false)
    }
    finally {
      unlistenInstall?.()
      setUpdating(false)
    }
  }

  async function restart() {
    if (busyAction)
      return
    setBusyAction('restart')
    try {
      await invoke('shutdown_harness')
    }
    catch (err) {
      console.error('[App] shutdown during restart failed:', err)
    }
    setServiceRunning(false)
    setIframeLoaded(false)
    try {
      await boot()
    }
    finally {
      setBusyAction(null)
    }
  }

  async function shutdown() {
    if (busyAction)
      return
    setBusyAction('shutdown')
    try {
      await invoke('shutdown_harness')
    }
    catch (err) {
      console.error('[App] shutdown failed:', err)
    }
    finally {
      setBusyAction(null)
    }
    setServiceRunning(false)
    setStatus('error')
    setErrorMsg(t('ui.stopped'))
  }

  // 服务未运行时点击“重试”：重新拉起服务并等待健康检查
  async function start() {
    if (busyAction)
      return
    setBusyAction('start')
    try {
      await boot()
    }
    finally {
      setBusyAction(null)
    }
  }

  async function openBrowser() {
    if (busyAction)
      return
    setBusyAction('openBrowser')
    try {
      await invoke('open_in_browser')
    }
    catch (err) {
      console.error('[App] open in browser failed:', err)
    }
    finally {
      setBusyAction(null)
    }
  }

  function dismissUpdate() {
    setUpdateInfo(null)
  }

  function dismissDownload() {
    setDownloadNotice(null)
  }

  // React StrictMode 在 dev 下会执行两次 effect；boot 内部每次执行都会
  // 递增 bootToken，此处再用 ref 兜底保证启动流程只挂载一次。
  // 不传依赖数组：boot 每次渲染都是新函数，effect 重跑时靠 ref 直接跳过。
  useEffect(() => {
    if (bootStartedRef.current)
      return
    bootStartedRef.current = true
    void boot()
  })

  // 监听 Rust 侧接管下载的完成事件：dsh iframe 内的下载在 WebView2 中是
  // 静默保存的（用户零感知），由外壳弹出“已保存 + 打开文件夹”提示
  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    listen<DownloadFinishedPayload>('harness-download-finished', (e) => {
      setDownloadNotice(e.payload)
    })
      .then((fn) => {
        unlisten = fn
      })
      .catch((err) => {
        console.error('[App] failed to listen harness-download-finished:', err)
      })
    return () => {
      unlisten?.()
    }
  }, [])

  // 进入 ready 后如果 iframe 长时间未加载（dsh 未就绪/挂起），
  // 转为错误界面，避免一直停在黑色加载遮罩
  useEffect(() => {
    if (status !== 'ready' || !serviceHealthy || iframeLoaded)
      return
    const timer = setTimeout(() => {
      setIframeLoaded(false)
      setIframeError(true)
    }, 20000)
    return () => clearTimeout(timer)
  }, [status, serviceHealthy, iframeLoaded, iframeKey])

  return {
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
  }
}
